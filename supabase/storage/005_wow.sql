-- ============================================================
-- 와우출고 — 위해 창고 재고를 로켓(immongRK_scan) 발주서 박스에 담아 중국에서 쿠팡 센터로 바로 출고
--   설계: D:\project\2026\immongRK_scan\docs\plan-wow.md (§3)
--
-- 진실의 자리
--   · 로켓 DB  : 무엇을 원하는가 (위해 배정 · 위해 박스) → ft_wow_sync_order 로 "발주서 전체 상태"를 민다 (멱등)
--   · 구매 DB  : 예약 · 담음 · 출고. 상태는 저장하지 않고 읽어 낸다
--       줄 담음 = ft_wow_items.picked_at / 박스 출고 = 묶인 1688 박스의 PACKED 행이 전부 shipment_id 를 가짐
--       (ft_box_info.shipment_id 는 쓰지 않는다 — POST /api/ft/shipments 가 재사용된 box_code 로 옛 박스까지 덮어썼다)
--
-- 출고예정 · 잔여수량 = 뷰 ft_storage_available 한 곳
--   reserved = 와우 미담음 줄 + 쉽먼트 요청(REQUESTED) / available = 재고 합 − reserved
--
-- 잠금 순서 (교착 방지): ft_wow:<user>:<발주번호> → ft_storage:<product_id> 를 product_id 오름차순으로.
--   다른 ft_storage_* 함수는 상품 잠금 하나만 잡는다.
--
-- 권한
--   · 로켓(anon 키)이 부르는 함수 : ft_wow_available / ft_wow_sync_order / ft_wow_order_state / ft_wow_doc_set
--     → SECURITY DEFINER + anon 실행 (ft_storage_request_create 와 같은 방식)
--   · 1688-invoice(service role) : ft_wow_pick / ft_wow_unpack / ft_storage_pick_core
--   · 서류 버킷 wow-docs (private) : anon 은 {발주번호}/{박스번호}/{label|manifest}.pdf 만 올리고 덮어쓴다
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-18)
-- ============================================================

-- ============================================================
-- 1) 테이블
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_wow_boxes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  order_number  text        NOT NULL,
  box_no        int         NOT NULL CHECK (box_no > 0),
  center        text,
  box_size      text,
  box_info_id   uuid        UNIQUE REFERENCES public.ft_box_info(id),
  label_path    text,
  manifest_path text,
  picked_at     timestamptz,
  picked_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ft_wow_boxes_order_box_uniq UNIQUE (user_id, order_number, box_no)
);

COMMENT ON TABLE public.ft_wow_boxes IS
  '와우 박스(발주번호-박스번호) — 로켓이 ft_wow_sync_order 로 만든다. box_info_id = 담을 때 묶인 1688 박스(1:1)';

CREATE TABLE IF NOT EXISTS public.ft_wow_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  order_number text        NOT NULL,
  wow_box_id   uuid        REFERENCES public.ft_wow_boxes(id) ON DELETE CASCADE,
  barcode      text        NOT NULL,
  product_id   uuid        NOT NULL,
  qty          int         NOT NULL CHECK (qty > 0),
  picked_qty   int         CHECK (picked_qty >= 0),
  outbound_id  uuid,
  picked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ft_wow_items_line_uniq UNIQUE NULLS NOT DISTINCT (user_id, order_number, wow_box_id, product_id)
);

COMMENT ON TABLE public.ft_wow_items IS
  '와우 줄 — wow_box_id NULL = 배정만 됐고 박스 미정(예약은 되지만 담을 수 없다). picked_at NULL 인 줄만 예약';

CREATE INDEX IF NOT EXISTS ft_wow_items_product_open_idx
  ON public.ft_wow_items (product_id) WHERE picked_at IS NULL;
CREATE INDEX IF NOT EXISTS ft_wow_items_box_idx
  ON public.ft_wow_items (wow_box_id);

ALTER TABLE public.ft_wow_boxes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ft_wow_items DISABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_wow_boxes, public.ft_wow_items FROM anon, authenticated;
GRANT SELECT ON public.ft_wow_boxes, public.ft_wow_items TO anon, authenticated;

-- ============================================================
-- 2) 출고예정 · 잔여수량 — 유일한 정의 (상품 단위)
--   UNION ALL 뒤 GROUP BY 라 user_id · product_id 조건이 각 원천까지 내려간다
-- ============================================================
CREATE OR REPLACE VIEW public.ft_storage_available
WITH (security_invoker = true) AS
SELECT user_id, product_id,
       SUM(q)::int     AS qty,
       SUM(r)::int     AS reserved,
       SUM(q - r)::int AS available
  FROM (
    SELECT user_id, product_id, delta AS q, 0 AS r FROM public.ft_storage_movements
    UNION ALL
    SELECT user_id, product_id, 0, qty FROM public.ft_wow_items WHERE picked_at IS NULL
    UNION ALL
    SELECT user_id, product_id, 0, qty FROM public.ft_storage_requests WHERE status = 'REQUESTED'
  ) s
 GROUP BY user_id, product_id;

GRANT SELECT ON public.ft_storage_available TO anon, authenticated;

-- ============================================================
-- 3) 와우 대상 상품 — 바코드 → product_id 의 유일한 정의
--   보관(STOCK) · DONE 아님 · 세트 아님 · 바코드 일치. 한 바코드에 여럿이면 먼저 배치된 순 → product_id 순
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_candidates(p_user_id uuid)
RETURNS TABLE (barcode text, product_id uuid, rank_no int)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.barcode, c.product_id,
         row_number() OVER (PARTITION BY c.barcode ORDER BY f.first_at NULLS LAST, c.product_id)::int
    FROM (
      SELECT DISTINCT trim(oi.barcode) AS barcode, oi.product_id
        FROM ft_order_items oi
       WHERE oi.user_id = p_user_id
         AND oi.arrival_route = 'STOCK'
         AND oi.status IS DISTINCT FROM 'DONE'
         AND COALESCE(oi.set_total, 1) <= 1
         AND oi.product_id IS NOT NULL
         AND NULLIF(trim(oi.barcode), '') IS NOT NULL
    ) c
    LEFT JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
        FROM ft_storage_movements m
       WHERE m.user_id = p_user_id AND m.product_id = c.product_id AND m.kind = 'PUTAWAY'
    ) f ON true;
$$;

-- ============================================================
-- 4) 꺼내기 핵심 (PICK + PACKED) — 잠금 · 예약 검사는 부르는 쪽이 한다
--   ft_storage_pick_to_shipment(재고 [쉽먼트]) 와 ft_wow_pick(와우 담기)이 같이 쓴다
--   오류: PICK_ITEM_INVALID / PICK_BOX_NOT_OPEN / PICK_BOX_TYPE_MISMATCH:<박스>:<상품> / PICK_INVALID_QTY / STOCK_*
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_pick_core(
  p_user_id           uuid,
  p_product_id        uuid,
  p_order_item_id     uuid,
  p_picks             jsonb,
  p_box_info_id       uuid,
  p_operator_name     text,
  p_force             boolean,
  p_shipment_type     text,
  p_size              text,
  p_personal_order_no text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item      ft_order_items%ROWTYPE;
  v_box       ft_box_info%ROWTYPE;
  v_type      jsonb;
  v_box_type  text;
  v_item_type text;
  v_pick      record;
  v_total     int := 0;
  v_balance   int;
  v_codes     text[] := '{}';
  v_code      text;
  v_out_id    uuid;
BEGIN
  SELECT * INTO v_item FROM ft_order_items WHERE id = p_order_item_id;
  IF NOT FOUND
     OR v_item.user_id IS DISTINCT FROM p_user_id
     OR v_item.product_id IS DISTINCT FROM p_product_id
     OR v_item.arrival_route <> 'STOCK'
     OR v_item.status = 'DONE' THEN
    RAISE EXCEPTION 'PICK_ITEM_INVALID';
  END IF;

  SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
  IF NOT FOUND
     OR v_box.user_id IS DISTINCT FROM p_user_id
     OR v_box.shipment_id IS NOT NULL
     OR v_box.status IS DISTINCT FROM 'PACKING' THEN
    RAISE EXCEPTION 'PICK_BOX_NOT_OPEN';
  END IF;

  -- ── 타입 확정 (상품 전체 행 기록) ──
  v_type := ft_storage_resolve_type(p_user_id, p_product_id, p_shipment_type, p_size, p_personal_order_no, true);

  -- ── 박스 타입 = 상품 타입 (허용 모드면 건너뜀) ──
  v_box_type  := ft_box_effective_type(p_box_info_id);
  v_item_type := ft_item_size_code(v_type->>'shipment_type', v_type->>'coupang_shipment_size');
  IF NOT p_force AND v_box_type IS DISTINCT FROM v_item_type THEN
    RAISE EXCEPTION 'PICK_BOX_TYPE_MISMATCH:%:%', COALESCE(v_box_type, '-'), v_item_type;
  END IF;

  -- ── 위치별 잔량 검증 ──
  IF p_picks IS NULL OR jsonb_typeof(p_picks) <> 'array' OR jsonb_array_length(p_picks) = 0 THEN
    RAISE EXCEPTION 'PICK_INVALID_QTY';
  END IF;
  FOR v_pick IN
    SELECT (e->>'location_id')::uuid AS location_id, SUM((e->>'qty')::int)::int AS qty
      FROM jsonb_array_elements(p_picks) e
     GROUP BY 1
  LOOP
    IF v_pick.qty IS NULL OR v_pick.qty < 1 THEN
      RAISE EXCEPTION 'PICK_INVALID_QTY';
    END IF;
    SELECT COALESCE(SUM(delta), 0) INTO v_balance
      FROM ft_storage_movements
     WHERE user_id = p_user_id AND product_id = p_product_id AND location_id = v_pick.location_id;
    IF v_pick.qty > v_balance THEN
      RAISE EXCEPTION 'PICK_INVALID_QTY';
    END IF;
    SELECT code INTO v_code FROM ft_storage_locations WHERE id = v_pick.location_id;
    v_codes := v_codes || v_code;
    v_total := v_total + v_pick.qty;
  END LOOP;

  -- ── PACKED 1행 (상품출고 V2 가 만드는 행과 같은 모양) ──
  INSERT INTO ft_fulfillment_outbounds (
    order_item_id, type, quantity, note,
    order_no, product_no, product_id,
    box_code, box_info_id,
    operator_name, user_id
  ) VALUES (
    v_item.id, 'PACKED', v_total, 'STOCK ' || array_to_string(v_codes, ','),
    array_to_string((string_to_array(v_item.order_no, '-'))[1:3], '-'),
    v_item.product_no, v_item.product_id,
    v_box.box_code, v_box.id,
    p_operator_name, p_user_id
  )
  RETURNING id INTO v_out_id;

  -- ── PICK 원장 (위치마다) ──
  INSERT INTO ft_storage_movements (
    user_id, product_id, order_item_id, location_id,
    kind, quantity, delta, outbound_id, operator_name
  )
  SELECT p_user_id, p_product_id, v_item.id, (e->>'location_id')::uuid,
         'PICK', SUM((e->>'qty')::int), -SUM((e->>'qty')::int), v_out_id, p_operator_name
    FROM jsonb_array_elements(p_picks) e
   GROUP BY (e->>'location_id')::uuid;

  RETURN jsonb_build_object('outbound_id', v_out_id, 'box_code', v_box.box_code, 'picked', v_total) || v_type;
END;
$$;

-- ============================================================
-- 5) 재고 → 쉽먼트 (서명 유지) — 와우 박스 거절 + 와우 예약분은 꺼내지 않는다
--   한도 = 재고 − 와우 미담음. 쉽먼트 요청 수량은 이 꺼내기의 몫이라 빼지 않는다(꺼내면 요청은 DONE).
--   꺼낸 뒤 잔량으로 검사한다 (꺼내기 전 "수량 ≤ 재고 − 와우" 와 같은 조건, 위반이면 전체 롤백)
--   오류 추가: PICK_BOX_WOW / PICK_OVER_AVAILABLE
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_pick_to_shipment(
  p_user_id           uuid,
  p_product_id        uuid,
  p_order_item_id     uuid,
  p_picks             jsonb,
  p_box_info_id       uuid,
  p_operator_name     text DEFAULT NULL,
  p_force             boolean DEFAULT false,
  p_shipment_type     text DEFAULT NULL,
  p_size              text DEFAULT NULL,
  p_personal_order_no text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = p_box_info_id) THEN
    RAISE EXCEPTION 'PICK_BOX_WOW';
  END IF;

  -- ── 타입 인자가 없으면 미처리 고객 요청의 타입을 쓴다 ──
  IF NULLIF(trim(COALESCE(p_shipment_type, '')), '') IS NULL THEN
    SELECT shipment_type, coupang_shipment_size, personal_order_no
      INTO p_shipment_type, p_size, p_personal_order_no
      FROM ft_storage_requests
     WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED'
     LIMIT 1;
  END IF;

  v_result := ft_storage_pick_core(p_user_id, p_product_id, p_order_item_id, p_picks, p_box_info_id,
                                   p_operator_name, p_force, p_shipment_type, p_size, p_personal_order_no);

  IF (SELECT COALESCE(SUM(delta), 0) FROM ft_storage_movements
       WHERE user_id = p_user_id AND product_id = p_product_id)
     < (SELECT COALESCE(SUM(qty), 0) FROM ft_wow_items
         WHERE user_id = p_user_id AND product_id = p_product_id AND picked_at IS NULL) THEN
    RAISE EXCEPTION 'PICK_OVER_AVAILABLE';
  END IF;

  -- ── 고객 요청 처리완료 ──
  UPDATE ft_storage_requests
     SET status = 'DONE', done_by = p_operator_name, done_at = now(), done_outbound_id = (v_result->>'outbound_id')::uuid
   WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED';

  RETURN v_result;
END;
$$;

-- ============================================================
-- 6) 고객 쉽먼트 요청 (서명 유지) — 수량 한도 = 잔여수량
--   미처리 요청 중복 검사를 먼저 (있으면 그 요청이 이미 잔여수량에서 빠져 있어 수량 오류로 보일 수 있다)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_request_create(
  p_user_id           uuid,
  p_product_id        uuid,
  p_qty               int,
  p_shipment_type     text,
  p_size              text DEFAULT NULL,
  p_personal_order_no text DEFAULT NULL,
  p_requested_by      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available int;
  v_type      jsonb;
  v_id        uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  IF NOT EXISTS (
    SELECT 1 FROM ft_order_items
     WHERE user_id = p_user_id AND product_id = p_product_id
       AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
  ) THEN
    RAISE EXCEPTION 'REQUEST_NOT_STOCK';
  END IF;

  IF EXISTS (SELECT 1 FROM ft_storage_requests WHERE product_id = p_product_id AND status = 'REQUESTED') THEN
    RAISE EXCEPTION 'REQUEST_EXISTS';
  END IF;

  SELECT COALESCE(MAX(available), 0) INTO v_available
    FROM ft_storage_available
   WHERE user_id = p_user_id AND product_id = p_product_id;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > v_available THEN
    RAISE EXCEPTION 'REQUEST_INVALID_QTY';
  END IF;

  v_type := ft_storage_resolve_type(p_user_id, p_product_id, p_shipment_type, p_size, p_personal_order_no, false);

  INSERT INTO ft_storage_requests (
    user_id, product_id, qty, shipment_type, coupang_shipment_size, personal_order_no, requested_by
  ) VALUES (
    p_user_id, p_product_id, p_qty,
    v_type->>'shipment_type', v_type->>'coupang_shipment_size', v_type->>'personal_order_no',
    p_requested_by
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id) || v_type;
END;
$$;

-- ============================================================
-- 7) 이동요청 생성 (서명 유지) — 와우 박스의 행은 건너뛴다 (skipped_closed)
--   supabase/shipment/002_move_requests.sql 과 같고 "닫힌 행" 조건만 추가
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_move_request_create(
  p_user_id      uuid,
  p_outbound_ids uuid[],
  p_target_type  text,
  p_requested_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   uuid := gen_random_uuid();
  v_id      uuid;
  v_row     ft_fulfillment_outbounds%ROWTYPE;
  v_type    text;
  v_created int := 0;
  v_dup     int := 0;
  v_same    int := 0;
  v_closed  int := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'request: 로그인 정보가 없습니다.';
  END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('A','B','C','P','X') THEN
    RAISE EXCEPTION 'request: 이동할 박스 타입이 올바르지 않습니다. (A / B / C / P / X)';
  END IF;
  IF p_outbound_ids IS NULL OR cardinality(p_outbound_ids) = 0 THEN
    RAISE EXCEPTION 'request: 이동요청할 항목을 선택해 주세요.';
  END IF;
  IF cardinality(p_outbound_ids) > 2000 THEN
    RAISE EXCEPTION 'request: 한 번에 2000건까지 요청할 수 있습니다.';
  END IF;

  FOR v_id IN SELECT DISTINCT unnest(p_outbound_ids) LOOP
    SELECT * INTO v_row FROM ft_fulfillment_outbounds WHERE id = v_id FOR SHARE;

    -- 포장이 철회되어 행이 없음
    IF NOT FOUND THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    IF v_row.user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'request: 다른 팀의 항목은 요청할 수 없습니다.';
    END IF;

    -- 이미 출고되었거나 포장 행이 아님 · 와우 박스(옮길 수 없다)
    IF v_row.type IS DISTINCT FROM 'PACKED' OR v_row.shipment_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = v_row.box_info_id) THEN
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    v_type := ft_box_effective_type(v_row.box_info_id);
    IF v_type = p_target_type THEN
      v_same := v_same + 1;
      CONTINUE;
    END IF;

    INSERT INTO ft_move_requests (
      user_id, outbound_id, request_group_id, target_type, from_box_code, requested_by
    ) VALUES (
      p_user_id, v_id, v_group, p_target_type, v_row.box_code,
      NULLIF(btrim(COALESCE(p_requested_by, '')), '')
    )
    ON CONFLICT (outbound_id) WHERE status = 'REQUESTED' DO NOTHING;

    IF FOUND THEN
      v_created := v_created + 1;
    ELSE
      v_dup := v_dup + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'group_id',          v_group,
    'created',           v_created,
    'skipped_duplicate', v_dup,
    'skipped_same_type', v_same,
    'skipped_closed',    v_closed
  );
END;
$$;

-- ============================================================
-- 8) 와우 박스 보호 트리거
--   와우에 묶인 1688 박스의 포장 행은 와우 함수만 넣고 · 옮기고 · 지운다
--   (상품출고 V2 스캔 INSERT · 쉽먼트 V2 이동/분할 · 부자재 · 포장 철회 · 수량 편집 모두 여기서 걸린다)
--   와우 함수는 트랜잭션 로컬 설정 ft.wow = 'on' 으로 통과. 출고(shipment_id · shipment_no 갱신)는 트리거 대상 컬럼이 아니다.
--   오류: WOW_BOX_LOCKED
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_outbound_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('ft.wow', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF (TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = OLD.box_info_id))
     OR (TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = NEW.box_info_id)) THEN
    RAISE EXCEPTION 'WOW_BOX_LOCKED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS ft_wow_outbound_guard ON public.ft_fulfillment_outbounds;
CREATE TRIGGER ft_wow_outbound_guard
  BEFORE INSERT OR DELETE OR UPDATE OF box_info_id, quantity ON public.ft_fulfillment_outbounds
  FOR EACH ROW
  EXECUTE FUNCTION public.ft_wow_outbound_guard();

-- 합배송: 와우 박스가 하위든 마스터든 끼면 거절
CREATE OR REPLACE FUNCTION public.ft_wow_box_info_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id IN (NEW.id, NEW.master_box_id, OLD.master_box_id)) THEN
    RAISE EXCEPTION 'WOW_BOX_LOCKED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ft_wow_box_info_guard ON public.ft_box_info;
CREATE TRIGGER ft_wow_box_info_guard
  BEFORE UPDATE OF master_box_id ON public.ft_box_info
  FOR EACH ROW
  WHEN (OLD.master_box_id IS DISTINCT FROM NEW.master_box_id)
  EXECUTE FUNCTION public.ft_wow_box_info_guard();

-- ============================================================
-- 9) 잠금 도우미 — 발주서 잠금 뒤 상품 잠금을 product_id 오름차순으로
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_lock(p_user_id uuid, p_order_number text, p_product_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ft_wow:' || p_user_id::text || ':' || p_order_number));
  FOR v_pid IN SELECT DISTINCT u FROM unnest(p_product_ids) u WHERE u IS NOT NULL ORDER BY u LOOP
    PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || v_pid::text));
  END LOOP;
END;
$$;

-- ============================================================
-- 10) 바코드별 잔여수량 (로켓 [배정] 계산)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_available(p_user_id uuid)
RETURNS TABLE (barcode text, qty int, reserved int, available int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.barcode,
         COALESCE(SUM(a.qty), 0)::int,
         COALESCE(SUM(a.reserved), 0)::int,
         COALESCE(SUM(a.available), 0)::int
    FROM ft_wow_candidates(p_user_id) c
    LEFT JOIN ft_storage_available a ON a.user_id = p_user_id AND a.product_id = c.product_id
   GROUP BY c.barcode;
$$;

-- ============================================================
-- 11) 발주서별 상태 — 줄 = (발주서, 박스, 바코드), 같은 바코드의 상품은 합친다
--   p_orders NULL = 출고 전 줄이 남은 모든 발주서
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_order_state(p_user_id uuid, p_orders text[] DEFAULT NULL)
RETURNS TABLE (
  order_number text,
  box_no       int,
  barcode      text,
  qty          int,
  picked_qty   int,
  picked_at    timestamptz,
  box_code     text,
  shipped_at   timestamptz,
  shipment_no  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH box AS (
    SELECT b.id, b.box_no, bi.box_code, s.shipped_at, s.shipment_no
      FROM ft_wow_boxes b
      LEFT JOIN ft_box_info bi ON bi.id = b.box_info_id
      LEFT JOIN LATERAL (
        SELECT MAX(sh.created_at) AS shipped_at, MAX(o.shipment_no) AS shipment_no
          FROM ft_fulfillment_outbounds o
          LEFT JOIN ft_shipments sh ON sh.id = o.shipment_id
         WHERE o.box_info_id = b.box_info_id AND o.type = 'PACKED'
        HAVING bool_and(o.shipment_id IS NOT NULL)
      ) s ON true
     WHERE b.user_id = p_user_id
  ),
  lines AS (
    SELECT i.order_number, bx.box_no, i.barcode,
           SUM(i.qty)::int AS qty, SUM(i.picked_qty)::int AS picked_qty, MAX(i.picked_at) AS picked_at,
           bx.box_code, bx.shipped_at, bx.shipment_no
      FROM ft_wow_items i
      LEFT JOIN box bx ON bx.id = i.wow_box_id
     WHERE i.user_id = p_user_id
       AND (p_orders IS NULL OR i.order_number = ANY (p_orders))
     GROUP BY i.order_number, bx.box_no, i.barcode, bx.box_code, bx.shipped_at, bx.shipment_no
  )
  SELECT l.*
    FROM lines l
   WHERE p_orders IS NOT NULL
      OR l.order_number IN (SELECT order_number FROM lines WHERE shipped_at IS NULL)
   ORDER BY l.order_number, l.box_no NULLS FIRST, l.barcode;
$$;

-- ============================================================
-- 12) 발주서 동기화 (로켓 → 구매 DB, 멱등) — "이 발주서의 원하는 상태 전체"
--   p_lines = [{barcode, box_no|null, qty>0}] (barcode+box_no 당 한 줄) · p_boxes = [{box_no, box_size}]
--   · 담은 박스(box_info_id 있음)는 얼어 있다: 원하는 줄 = 담은 수량(바코드별, 0 은 줄 없음)이어야 하고
--     박스가 빠질 수 없다 → WOW_BOX_PICKED:<box_no>. 같으면 qty := picked_qty
--   · 안 담은 박스 · 줄은 원하는 상태로 통째로 바꾼다. 바코드의 대상 상품이 여럿이면 순서대로
--     잔여수량만큼 채우고 남는 것은 마지막 상품에 둔다(→ 모자라면 아래 검증에 걸린다)
--   · 이번 호출로 예약이 늘어난 상품이 잔여수량 < 0 이면 WOW_SHORT:<바코드,…>
--   오류: WOW_INVALID_INPUT / WOW_BARCODE_NOT_FOUND:<바코드,…> / WOW_BOX_PICKED:<box_no> / WOW_SHORT:<바코드,…>
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_sync_order(
  p_user_id      uuid,
  p_order_number text,
  p_center       text,
  p_lines        jsonb,
  p_boxes        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  text := NULLIF(trim(COALESCE(p_order_number, '')), '');
  v_ok     boolean;
  v_bad    text;
  v_before jsonb;
  v_line   record;
  v_cand   record;
  v_box_id uuid;
  v_left   int;
  v_take   int;
BEGIN
  -- ── 입력 검증 (형 변환 실패도 같은 코드) ──
  IF p_user_id IS NULL OR v_order IS NULL
     OR jsonb_typeof(COALESCE(p_lines, 'null')) <> 'array'
     OR jsonb_typeof(COALESCE(p_boxes, 'null')) <> 'array' THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  BEGIN
    SELECT COALESCE(bool_and(NULLIF(trim(l.barcode), '') IS NOT NULL AND l.qty > 0 AND (l.box_no IS NULL OR l.box_no > 0)), true)
           AND count(*) = count(DISTINCT (trim(l.barcode), l.box_no))
           AND NOT EXISTS (
             SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(box_no int)
              WHERE x.box_no IS NOT NULL
                AND x.box_no NOT IN (SELECT y.box_no FROM jsonb_to_recordset(p_boxes) AS y(box_no int) WHERE y.box_no IS NOT NULL))
           AND (SELECT count(*) = count(DISTINCT y.box_no) AND count(*) = count(y.box_no)
                  FROM jsonb_to_recordset(p_boxes) AS y(box_no int))
      INTO v_ok
      FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  -- ── 잠금: 지금 이 발주서의 상품 + 원하는 바코드의 대상 상품 ──
  PERFORM ft_wow_lock(p_user_id, v_order, ARRAY(
    SELECT product_id FROM ft_wow_items WHERE user_id = p_user_id AND order_number = v_order
    UNION
    SELECT c.product_id FROM ft_wow_candidates(p_user_id) c
     WHERE c.barcode IN (SELECT trim(l.barcode) FROM jsonb_to_recordset(p_lines) AS l(barcode text))
  ));

  -- ── 얼어 있는 박스: 빠졌거나 줄이 담은 수량과 다르면 거절 ──
  SELECT string_agg(b.box_no::text, ',' ORDER BY b.box_no) INTO v_bad
    FROM ft_wow_boxes b
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.box_info_id IS NOT NULL
     AND EXISTS (
       (SELECT i.barcode, SUM(i.picked_qty)::int FROM ft_wow_items i
         WHERE i.wow_box_id = b.id GROUP BY i.barcode HAVING SUM(i.picked_qty) > 0)
       EXCEPT ALL
       (SELECT trim(l.barcode), l.qty FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
         WHERE l.box_no = b.box_no)
       UNION ALL
       ((SELECT trim(l.barcode), l.qty FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
          WHERE l.box_no = b.box_no)
        EXCEPT ALL
        (SELECT i.barcode, SUM(i.picked_qty)::int FROM ft_wow_items i
          WHERE i.wow_box_id = b.id GROUP BY i.barcode HAVING SUM(i.picked_qty) > 0))
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_PICKED:%', v_bad;
  END IF;

  -- ── 대상 상품이 없는 바코드 (얼어 있는 박스의 줄은 이미 묶인 상품이라 제외) ──
  SELECT string_agg(DISTINCT trim(l.barcode), ',') INTO v_bad
    FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int)
   WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                      WHERE b.user_id = p_user_id AND b.order_number = v_order
                        AND b.box_no = l.box_no AND b.box_info_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM ft_wow_candidates(p_user_id) c WHERE c.barcode = trim(l.barcode));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BARCODE_NOT_FOUND:%', v_bad;
  END IF;

  -- ── 얼어 있는 줄: qty := 담은 수량 (0 으로 담은 줄은 지운다) ──
  DELETE FROM ft_wow_items
   WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NOT NULL AND picked_qty = 0;
  UPDATE ft_wow_items SET qty = picked_qty
   WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NOT NULL AND qty <> picked_qty;

  -- ── 안 담은 줄 · 박스를 원하는 상태로 (전후 예약 비교용으로 먼저 기록) ──
  SELECT COALESCE(jsonb_object_agg(product_id, q), '{}') INTO v_before
    FROM (SELECT product_id, SUM(qty) AS q FROM ft_wow_items
           WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL
           GROUP BY product_id) s;

  DELETE FROM ft_wow_items WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL;
  DELETE FROM ft_wow_boxes b
   WHERE b.user_id = p_user_id AND b.order_number = v_order AND b.box_info_id IS NULL
     AND b.box_no NOT IN (SELECT l.box_no FROM jsonb_to_recordset(p_lines) AS l(box_no int) WHERE l.box_no IS NOT NULL);

  INSERT INTO ft_wow_boxes AS b (user_id, order_number, box_no, center, box_size)
  SELECT p_user_id, v_order, y.box_no, NULLIF(trim(COALESCE(p_center, '')), ''), NULLIF(trim(COALESCE(y.box_size, '')), '')
    FROM jsonb_to_recordset(p_boxes) AS y(box_no int, box_size text)
   WHERE y.box_no IN (SELECT l.box_no FROM jsonb_to_recordset(p_lines) AS l(box_no int))
  ON CONFLICT (user_id, order_number, box_no) DO UPDATE
     SET center     = EXCLUDED.center,
         box_size   = CASE WHEN b.box_info_id IS NULL THEN EXCLUDED.box_size ELSE b.box_size END,
         updated_at = now();

  FOR v_line IN
    SELECT trim(l.barcode) AS barcode, l.box_no, l.qty
      FROM jsonb_to_recordset(p_lines) AS l(barcode text, box_no int, qty int)
     WHERE NOT EXISTS (SELECT 1 FROM ft_wow_boxes b
                        WHERE b.user_id = p_user_id AND b.order_number = v_order
                          AND b.box_no = l.box_no AND b.box_info_id IS NOT NULL)
     ORDER BY l.box_no NULLS FIRST, 1
  LOOP
    -- box_no NULL 이면 행이 없어 v_box_id 도 NULL (박스 미정)
    SELECT id INTO v_box_id FROM ft_wow_boxes
     WHERE user_id = p_user_id AND order_number = v_order AND box_no = v_line.box_no;
    v_left := v_line.qty;
    -- 앞에서 넣은 줄도 예약에 들어가므로 뷰의 잔여수량이 곧 남은 자리다
    FOR v_cand IN
      SELECT c.product_id, c.rank_no, count(*) OVER () AS n,
             GREATEST(COALESCE(a.available, 0), 0) AS cap
        FROM ft_wow_candidates(p_user_id) c
        LEFT JOIN ft_storage_available a ON a.user_id = p_user_id AND a.product_id = c.product_id
       WHERE c.barcode = v_line.barcode
       ORDER BY c.rank_no
    LOOP
      v_take := CASE WHEN v_cand.rank_no = v_cand.n THEN v_left ELSE LEAST(v_left, v_cand.cap) END;
      IF v_take > 0 THEN
        INSERT INTO ft_wow_items (user_id, order_number, wow_box_id, barcode, product_id, qty)
        VALUES (p_user_id, v_order, v_box_id, v_line.barcode, v_cand.product_id, v_take);
        v_left := v_left - v_take;
      END IF;
      EXIT WHEN v_left = 0;
    END LOOP;
  END LOOP;

  -- ── 예약이 늘어난 상품만 잔여수량 검사 ──
  SELECT string_agg(DISTINCT i.barcode, ',') INTO v_bad
    FROM (SELECT product_id, MAX(barcode) AS barcode, SUM(qty) AS q FROM ft_wow_items
           WHERE user_id = p_user_id AND order_number = v_order AND picked_at IS NULL
           GROUP BY product_id) i
    JOIN ft_storage_available a ON a.user_id = p_user_id AND a.product_id = i.product_id
   WHERE i.q > COALESCE((v_before->>i.product_id::text)::int, 0)
     AND a.available < 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_SHORT:%', v_bad;
  END IF;

  RETURN jsonb_build_object(
    'order_number', v_order,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM ft_wow_order_state(p_user_id, ARRAY[v_order]) s), '[]')
  );
END;
$$;

-- ============================================================
-- 13) 서류 경로 기록 (로켓이 wow-docs 에 올린 뒤)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_doc_set(
  p_user_id      uuid,
  p_order_number text,
  p_box_no       int,
  p_kind         text,
  p_path         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind NOT IN ('label', 'manifest') OR NULLIF(trim(COALESCE(p_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  UPDATE ft_wow_boxes
     SET label_path    = CASE WHEN p_kind = 'label'    THEN trim(p_path) ELSE label_path END,
         manifest_path = CASE WHEN p_kind = 'manifest' THEN trim(p_path) ELSE manifest_path END,
         updated_at    = now()
   WHERE user_id = p_user_id AND order_number = trim(p_order_number) AND box_no = p_box_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
END;
$$;

-- ============================================================
-- 14) 와우 담기 — 와우 박스 하나 = 빈 1688 박스 하나 (1:1)
--   p_lines = [{item_id, picks: [{location_id, qty}]}] — 그 박스의 줄을 전부 한 번씩 (0 개 담기 = picks [])
--   줄마다 담은 수량 ≤ 요청, 전부 0 이면 거절. 타입은 DIRECT(X) 로 확정 → 박스도 X 여야 한다
--   담으면 그 줄의 예약은 끝난다 (적게 담은 나머지도 풀린다)
--   오류: WOW_BOX_NOT_FOUND / WOW_BOX_ALREADY_PICKED / WOW_BOX_NOT_EMPTY / WOW_INVALID_INPUT
--         WOW_PICK_OVER / WOW_PICK_EMPTY / PICK_* · STOCK_* (꺼내기 핵심)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_pick(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_box_info_id   uuid,
  p_lines         jsonb,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box     ft_wow_boxes%ROWTYPE;
  v_bi      ft_box_info%ROWTYPE;
  v_line    record;
  v_qty     int;
  v_total   int := 0;
  v_item_id uuid;
  v_result  jsonb;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  -- ── 잠금 뒤 다시 읽기 (로켓 동기화 · 다른 창의 담기와 겨룬다) ──
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NOT NULL THEN
    RAISE EXCEPTION 'WOW_BOX_ALREADY_PICKED';
  END IF;

  -- ── 1688 박스: 그 사업자 · 미출고 · 포장 행이 한 번도 없음 · 합배송과 무관 ──
  SELECT * INTO v_bi FROM ft_box_info WHERE id = p_box_info_id FOR UPDATE;
  IF NOT FOUND
     OR v_bi.user_id IS DISTINCT FROM p_user_id
     OR v_bi.shipment_id IS NOT NULL
     OR v_bi.master_box_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM ft_box_info WHERE master_box_id = p_box_info_id)
     OR EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = p_box_info_id)
     OR EXISTS (SELECT 1 FROM ft_wow_boxes WHERE box_info_id = p_box_info_id) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_EMPTY';
  END IF;

  -- ── 줄 목록 = 이 박스의 줄 전부, 한 번씩 ──
  IF jsonb_typeof(COALESCE(p_lines, 'null')) <> 'array'
     OR (SELECT count(*) FROM jsonb_array_elements(p_lines)) <> (SELECT count(*) FROM ft_wow_items WHERE wow_box_id = p_wow_box_id)
     OR EXISTS (SELECT 1 FROM ft_wow_items i WHERE i.wow_box_id = p_wow_box_id
                 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) e WHERE e->>'item_id' = i.id::text)) THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  UPDATE ft_wow_boxes
     SET box_info_id = p_box_info_id, picked_at = now(), picked_by = p_operator_name, updated_at = now()
   WHERE id = p_wow_box_id;

  FOR v_line IN
    SELECT i.id, i.product_id, i.qty, COALESCE(e->'picks', '[]') AS picks
      FROM ft_wow_items i
      JOIN jsonb_array_elements(p_lines) e ON e->>'item_id' = i.id::text
     WHERE i.wow_box_id = p_wow_box_id
     ORDER BY i.product_id
  LOOP
    SELECT COALESCE(SUM((p->>'qty')::int), 0) INTO v_qty FROM jsonb_array_elements(v_line.picks) p;
    IF v_qty < 0 OR v_qty > v_line.qty THEN
      RAISE EXCEPTION 'WOW_PICK_OVER';
    END IF;
    v_result := NULL;
    IF v_qty > 0 THEN
      SELECT id INTO v_item_id FROM ft_order_items
       WHERE user_id = p_user_id AND product_id = v_line.product_id
         AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
       ORDER BY set_seq NULLS FIRST, item_no LIMIT 1;
      v_result := ft_storage_pick_core(p_user_id, v_line.product_id, v_item_id, v_line.picks, p_box_info_id,
                                       p_operator_name, false, 'DIRECT', NULL, NULL);
    END IF;
    UPDATE ft_wow_items
       SET picked_qty = v_qty, outbound_id = (v_result->>'outbound_id')::uuid, picked_at = now()
     WHERE id = v_line.id;
    v_total := v_total + v_qty;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'WOW_PICK_EMPTY';
  END IF;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('box_code', v_bi.box_code, 'picked', v_total);
END;
$$;

-- ============================================================
-- 15) 와우 담기 취소 — 출고 전에만. 포장 행을 꺼냈던 위치로 되돌리고 묶음 · 담은 기록을 지운다
--   (줄은 다시 요청 상태 → 예약이 돌아온다. 1688 박스는 빈 박스로 남는다)
--   오류: WOW_BOX_NOT_FOUND / WOW_BOX_NOT_PICKED / WOW_BOX_SHIPPED
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_unpack(
  p_user_id       uuid,
  p_wow_box_id    uuid,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box  ft_wow_boxes%ROWTYPE;
  v_out  uuid;
  v_back int := 0;
BEGIN
  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  PERFORM ft_wow_lock(p_user_id, v_box.order_number,
                      ARRAY(SELECT product_id FROM ft_wow_items WHERE wow_box_id = p_wow_box_id));

  SELECT * INTO v_box FROM ft_wow_boxes WHERE id = p_wow_box_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF v_box.box_info_id IS NULL THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_PICKED';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id AND shipment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_out IN SELECT id FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id ORDER BY id LOOP
    v_back := v_back + COALESCE((ft_storage_unpick_outbound(v_out, p_operator_name)->>'returned')::int, 0);
  END LOOP;
  -- 꺼내기 핵심이 만든 행은 전부 PICK 링크가 있다 — 남았다면 재고로 못 돌린 행
  IF EXISTS (SELECT 1 FROM ft_fulfillment_outbounds WHERE box_info_id = v_box.box_info_id) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_EMPTY';
  END IF;

  UPDATE ft_wow_items SET picked_qty = NULL, outbound_id = NULL, picked_at = NULL WHERE wow_box_id = p_wow_box_id;
  UPDATE ft_wow_boxes SET box_info_id = NULL, picked_at = NULL, picked_by = NULL, updated_at = now() WHERE id = p_wow_box_id;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('returned', v_back);
END;
$$;

-- ============================================================
-- 16) 서류 버킷 — private. anon(로켓)은 정해진 경로만 올리고 덮어쓴다
--   덮어쓰기(upsert)는 INSERT ... ON CONFLICT DO UPDATE 라 SELECT · UPDATE 정책도 있어야 한다
--   1688-invoice 는 service role 의 signed URL 로 읽는다
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wow-docs', 'wow-docs', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ft_wow_docs_anon_insert ON storage.objects;
CREATE POLICY ft_wow_docs_anon_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'wow-docs' AND name ~ '^[^/]+/[0-9]+/(label|manifest)\.pdf$');

DROP POLICY IF EXISTS ft_wow_docs_anon_update ON storage.objects;
CREATE POLICY ft_wow_docs_anon_update ON storage.objects
  FOR UPDATE TO anon
  USING (bucket_id = 'wow-docs' AND name ~ '^[^/]+/[0-9]+/(label|manifest)\.pdf$')
  WITH CHECK (bucket_id = 'wow-docs' AND name ~ '^[^/]+/[0-9]+/(label|manifest)\.pdf$');

DROP POLICY IF EXISTS ft_wow_docs_anon_select ON storage.objects;
CREATE POLICY ft_wow_docs_anon_select ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'wow-docs' AND name ~ '^[^/]+/[0-9]+/(label|manifest)\.pdf$');

-- ============================================================
-- 17) 권한
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_wow_candidates(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_lock(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_pick_core(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_pick(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_wow_unpack(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_wow_candidates(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_lock(uuid, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_pick_core(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_pick(uuid, uuid, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_unpack(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.ft_wow_available(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ft_wow_order_state(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ft_wow_sync_order(uuid, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ft_wow_doc_set(uuid, text, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_wow_available(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_order_state(uuid, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_sync_order(uuid, text, text, jsonb, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ft_wow_doc_set(uuid, text, int, text, text) TO anon, authenticated, service_role;
-- request_create · move_request_create 의 anon 실행 권한은 003 · shipment/002 그대로 (CREATE OR REPLACE 는 권한을 유지한다)
-- 트리거 함수는 anon UPDATE 경로에서도 실행돼야 하므로 EXECUTE 회수하지 않는다
