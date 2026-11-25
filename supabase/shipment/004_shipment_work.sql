-- ============================================================
-- 쉽먼트 작업 (작업시작 → 작업취소 | 출고) — 출고를 빠뜨려 다음날 같은 박스에 계속 담기는 일을 막는다
--   앞 단계: supabase/shipment/001 ~ 003 · supabase/storage/008_wow_ready.sql · 010_wow_flow.sql
--
-- 규칙 (사업자 단위)
--   · 쉽먼트 V2 에서 [작업시작] 을 눌러야 쉽먼트 작업(이동 · 합배송 · 생성 · 엑셀 · 마킹라벨 · 출고)을 할 수 있다
--   · 작업 중에는 출고 대기 목록이 얼어 있다 — 쉽먼트 V2 밖에서는 그 사업자의 박스에 담거나 뺄 수 없다
--       상품출고 V2 저장 · 포장 철회 · 재고 [쉽먼트] · 와우출고 [출고준비완료] / [바로 출고준비] / [출고준비 취소] / [발주취소]
--   · 작업은 [작업취소] 또는 [출고] 로만 끝난다. 끝나야 다시 담을 수 있다
--       → 출고를 빠뜨리면 다음에 담으려는 사람이 막히고, 누가 언제 시작한 작업인지 안내를 본다
--
-- 출고 대기 목록 = 포장 행(ft_fulfillment_outbounds) 중 PACKED · 미출고 · 박스가 있는 행
--   (와우출고 박스는 출고준비 전이면 쉽먼트 V2 에 보이지 않으므로 목록이 아니다 — app/api/ft/shipment-v2/route.ts 와 같은 기준)
--
-- 담는 쪽을 막는 곳은 DB 한 곳이다 (포장 행 트리거). 담는 길이 여럿이라(화면 API 직접 저장 · DB 함수) 화면마다 막으면 샌다.
--   쉽먼트 V2 의 이동 · 부자재 생성은 DB 함수라 그 안에서 "쉽먼트 작업" 표시(ft.shipment_work = 'on')를 켜고 지나간다.
--   출고(shipment_id 채우기)는 트리거가 보는 칼럼(박스 · 수량)을 건드리지 않는다.
-- 쉽먼트 쪽("작업시작 전에는 이동 · 생성 · 출고 불가")은 API 가 본다 (lib/shipmentWork.ts) — 길이 셋뿐이고 화면과 같이 배포된다.
--   DB 함수에서 막지 않는 까닭: 이 스크립트를 먼저 적용해도 그때 운영 중인 화면의 이동 · 생성이 그대로 돌아가야 한다.
--   그래서 이 스크립트는 열린 작업이 하나도 없는 동안에는 아무 동작도 바꾸지 않는다.
--
-- 같은 순간에 겨룰 때: 담는 쪽은 사업자 잠금을 함께 쓰는 잠금으로, [작업시작] 은 혼자 쓰는 잠금으로 잡는다
--   → 저장 중이던 담기가 끝난 뒤에 작업이 시작되고, 작업이 시작된 뒤의 담기는 거절된다 (엑셀과 실제가 어긋나지 않는다)
--
-- 권한: 1688-invoice(service role) 전용
-- 오류: SHIPMENT_WORK_LOCKED(작업 중이라 담거나 뺄 수 없음) / SHIPMENT_WORK_NOT_STARTED(끝낼 작업이 없음)
--       SHIPMENT_WORK_ALREADY_STARTED / SHIPMENT_WORK_INVALID_INPUT
--
-- 적용: 2026-11-26 (운영 DB mkcxpkblohioqboemmah) — 같은 트랜잭션에서 자체 시험(작업 중 담기 · 철회 · 수량 변경 거절,
--   박스 없는 행 · 다른 사업자는 그대로, 이동 · 부자재 생성 · 출고 표시는 통과, 와우출고 [바로 출고준비] 거절,
--   끝낸 뒤 다시 담기)을 돌려 통과한 뒤 확정했다 (시험 변경은 전부 되돌림).
--   와우출고 [출고준비 취소] · 출고준비 박스의 [발주취소] 거절은 그때 출고 전인 출고준비 박스가 없어 시험하지 못했다
-- ============================================================

-- ============================================================
-- 1) 작업 기록 — 사업자마다 열린 작업은 하나. 끝난 작업은 기록으로 남는다 (누가 언제 시작 · 끝냈나)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_shipment_works (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.ft_users (id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  started_by  text NOT NULL,
  ended_at    timestamptz,
  ended_by    text,
  -- SHIPPED = [출고] 로 끝남 · CANCELLED = [작업취소] 로 끝남
  end_kind    text CHECK (end_kind IN ('SHIPPED', 'CANCELLED')),
  shipment_id uuid REFERENCES public.ft_shipments (id),
  CONSTRAINT ft_shipment_works_end_chk
    CHECK ((ended_at IS NULL) = (end_kind IS NULL) AND (shipment_id IS NULL OR end_kind = 'SHIPPED'))
);

COMMENT ON TABLE public.ft_shipment_works IS
  '쉽먼트 작업 기록. ended_at 이 NULL 인 행 = 지금 작업 중 (그 사업자의 출고 대기 목록이 얼어 있다)';

CREATE UNIQUE INDEX IF NOT EXISTS ft_shipment_works_open_uniq
  ON public.ft_shipment_works (user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ft_shipment_works_user_idx
  ON public.ft_shipment_works (user_id, started_at DESC);

ALTER TABLE public.ft_shipment_works ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ft_shipment_works FROM anon, authenticated;

-- ============================================================
-- 2) 잠금 확인 — 담는 쪽 · 쉽먼트 쪽이 부르는 두 함수
-- ============================================================

-- ── 담는 쪽: 그 사업자가 쉽먼트 작업 중이면 거절 ──
CREATE OR REPLACE FUNCTION public.ft_shipment_work_assert_closed(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtext('ft_shipment_work:' || p_user_id::text));
  IF EXISTS (SELECT 1 FROM ft_shipment_works WHERE user_id = p_user_id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_WORK_LOCKED';
  END IF;
END;
$$;

-- ── 쉽먼트 쪽: 이 트랜잭션에 "쉽먼트 작업" 표시를 켠다 (포장 행 트리거가 지나가게) ──
--   쉽먼트 V2 의 DB 함수(이동 · 부자재 생성)만 부른다. 작업 중인지는 API 가 먼저 본다
CREATE OR REPLACE FUNCTION public.ft_shipment_work_enter()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('ft.shipment_work', 'on', true);
END;
$$;

-- ============================================================
-- 3) [작업시작] · [작업취소] / [출고] 로 끝내기
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_shipment_work_start(
  p_user_id       uuid,
  p_operator_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_by   text := NULLIF(btrim(COALESCE(p_operator_name, '')), '');
  v_work ft_shipment_works%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR v_by IS NULL OR NOT EXISTS (SELECT 1 FROM ft_users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'SHIPMENT_WORK_INVALID_INPUT';
  END IF;

  -- 저장 중이던 담기가 끝나기를 기다린다 (그 뒤의 담기는 이 작업을 보고 거절된다)
  PERFORM pg_advisory_xact_lock(hashtext('ft_shipment_work:' || p_user_id::text));
  IF EXISTS (SELECT 1 FROM ft_shipment_works WHERE user_id = p_user_id AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'SHIPMENT_WORK_ALREADY_STARTED';
  END IF;

  INSERT INTO ft_shipment_works (user_id, started_by) VALUES (p_user_id, v_by) RETURNING * INTO v_work;
  RETURN jsonb_build_object('id', v_work.id, 'started_at', v_work.started_at, 'started_by', v_work.started_by);
END;
$$;

-- p_kind: 'CANCELLED' = [작업취소] · 'SHIPPED' = [출고] (p_shipment_id = 방금 만든 쉽먼트)
CREATE OR REPLACE FUNCTION public.ft_shipment_work_end(
  p_user_id       uuid,
  p_kind          text,
  p_operator_name text DEFAULT NULL,
  p_shipment_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_work ft_shipment_works%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('SHIPPED', 'CANCELLED')
     OR (p_kind = 'SHIPPED') <> (p_shipment_id IS NOT NULL)
     OR (p_shipment_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ft_shipments WHERE id = p_shipment_id AND user_id = p_user_id)) THEN
    RAISE EXCEPTION 'SHIPMENT_WORK_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_shipment_work:' || p_user_id::text));
  SELECT * INTO v_work FROM ft_shipment_works WHERE user_id = p_user_id AND ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIPMENT_WORK_NOT_STARTED';
  END IF;

  UPDATE ft_shipment_works
     SET ended_at = now(),
         ended_by = NULLIF(btrim(COALESCE(p_operator_name, '')), ''),
         end_kind = p_kind,
         shipment_id = p_shipment_id
   WHERE id = v_work.id;
  RETURN jsonb_build_object('id', v_work.id, 'end_kind', p_kind);
END;
$$;

-- ============================================================
-- 4) 포장 행 트리거 — 작업 중인 사업자의 출고 대기 목록은 쉽먼트 작업으로만 바뀐다
--   보는 변화: 행 추가 · 삭제 · 박스(box_info_id · box_code) / 수량 변경
--   출고 대기 목록에 있는(또는 들어오는) 행만 본다 — 박스 없는 와우 포장 행 · 출고준비 전 와우 박스의 행은 지나간다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_shipment_work_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('ft.shipment_work', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP <> 'INSERT'
     AND OLD.type = 'PACKED' AND OLD.shipment_id IS NULL AND OLD.user_id IS NOT NULL
     AND (OLD.box_info_id IS NOT NULL OR OLD.box_code IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes w WHERE w.box_info_id = OLD.box_info_id AND w.ready_at IS NULL) THEN
    PERFORM ft_shipment_work_assert_closed(OLD.user_id);
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.type = 'PACKED' AND NEW.shipment_id IS NULL AND NEW.user_id IS NOT NULL
     AND (NEW.box_info_id IS NOT NULL OR NEW.box_code IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM ft_wow_boxes w WHERE w.box_info_id = NEW.box_info_id AND w.ready_at IS NULL) THEN
    PERFORM ft_shipment_work_assert_closed(NEW.user_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS ft_shipment_work_guard ON public.ft_fulfillment_outbounds;
CREATE TRIGGER ft_shipment_work_guard
  BEFORE INSERT OR DELETE OR UPDATE OF box_info_id, box_code, quantity ON public.ft_fulfillment_outbounds
  FOR EACH ROW
  EXECUTE FUNCTION public.ft_shipment_work_guard();

REVOKE ALL ON FUNCTION public.ft_shipment_work_assert_closed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_shipment_work_enter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_shipment_work_start(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_shipment_work_end(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_shipment_work_assert_closed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_shipment_work_enter() TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_shipment_work_start(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ft_shipment_work_end(uuid, text, text, uuid) TO service_role;

-- ============================================================
-- 5) 쉽먼트 V2 의 포장 행 변경 — "쉽먼트 작업" 표시를 켜고
--   003_manual_shipment_item.sql 의 3) 4) 와 같고, 맨 앞에 ft_shipment_work_enter 한 줄이 늘었다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_shipment_manual_create(
  p_user_id       uuid,
  p_box_info_id   uuid,
  p_item          jsonb,
  p_arrival       int,
  p_scan          int,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box        ft_box_info%ROWTYPE;
  v_product_no text    := NULLIF(btrim(COALESCE(p_item->>'product_no', '')), '');
  v_item_name  text    := NULLIF(btrim(COALESCE(p_item->>'item_name', '')), '');
  v_size       text    := upper(NULLIF(btrim(COALESCE(p_item->>'size_code', '')), ''));
  v_price_txt  text    := NULLIF(btrim(COALESCE(p_item->>'price_cny', '')), '');
  v_price      numeric;
  v_operator   text    := NULLIF(btrim(COALESCE(p_operator_name, '')), '');
  v_manual_id  uuid;
  v_out_id     uuid;
BEGIN
  -- ── 입력 검증 ──
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'manual: 사용자를 선택해 주세요.';
  END IF;
  -- 쉽먼트 작업 표시를 켠다 — 작업 중에도 포장 행 트리거를 지나간다 (004_shipment_work.sql)
  PERFORM ft_shipment_work_enter();
  IF v_product_no IS NULL THEN
    RAISE EXCEPTION 'manual: 주문번호를 입력해 주세요.';
  END IF;
  IF v_item_name IS NULL THEN
    RAISE EXCEPTION 'manual: 상품정보를 입력해 주세요.';
  END IF;
  IF v_size IS NULL OR v_size NOT IN ('A','B','C','P','X') THEN
    RAISE EXCEPTION 'manual: 쉽먼트사이즈를 선택해 주세요. (A / B / C / P / X)';
  END IF;
  IF p_arrival IS NULL OR p_arrival <= 0 THEN
    RAISE EXCEPTION 'manual: 입고 수량은 1 이상이어야 합니다.';
  END IF;
  IF p_scan IS NULL OR p_scan <= 0 OR p_scan > p_arrival THEN
    RAISE EXCEPTION 'manual: 스캔 수량은 1 이상, 입고 수량 이하여야 합니다.';
  END IF;
  IF v_price_txt IS NOT NULL THEN
    BEGIN
      v_price := v_price_txt::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'manual: 단가가 숫자가 아닙니다.';
    END;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'manual: 단가는 0 이상이어야 합니다.';
    END IF;
  END IF;

  -- ── 박스 검증 + 공유 잠금 (ft_move_outbound 와 같은 기준) ──
  SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual: 박스를 찾을 수 없습니다.';
  END IF;
  IF v_box.user_id IS DISTINCT FROM p_user_id
     OR v_box.shipment_id IS NOT NULL
     OR v_box.status IS DISTINCT FROM 'PACKING' THEN
    RAISE EXCEPTION 'manual: 박스가 이미 출고되었거나 다른 사용자의 박스입니다.';
  END IF;

  -- ── 부자재 1행 ──
  INSERT INTO ft_shipment_manual_items (
    user_id, product_no, barcode, item_name, china_option,
    price_cny, customs_category, size_code, arrival_qty, created_by
  ) VALUES (
    p_user_id, v_product_no,
    NULLIF(btrim(COALESCE(p_item->>'barcode', '')), ''),
    v_item_name,
    NULLIF(btrim(COALESCE(p_item->>'china_option', '')), ''),
    v_price,
    NULLIF(btrim(COALESCE(p_item->>'customs_category', '')), ''),
    v_size, p_arrival, v_operator
  )
  RETURNING id INTO v_manual_id;

  -- ── 포장 1행 ──
  INSERT INTO ft_fulfillment_outbounds (
    order_item_id, manual_item_id, type, quantity, note,
    product_no, box_code, box_info_id, operator_name, user_id
  ) VALUES (
    NULL, v_manual_id, 'PACKED', p_scan, 'MANUAL',
    v_product_no, v_box.box_code, v_box.id, v_operator, p_user_id
  )
  RETURNING id INTO v_out_id;

  RETURN jsonb_build_object(
    'manual_item_id', v_manual_id,
    'outbound_id',    v_out_id,
    'box_code',       v_box.box_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ft_move_outbound(
  p_id          uuid,
  p_box_info_id uuid,
  p_user_id     uuid,
  p_qty         int DEFAULT NULL
)
RETURNS TABLE (result text, moved_id uuid, moved_qty int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_box    ft_box_info%ROWTYPE;
  v_src    ft_fulfillment_outbounds%ROWTYPE;
  v_trace  text;
  v_new_id uuid;
BEGIN
  -- ── 0) 쉽먼트 작업 표시를 켠다 — 작업 중에도 포장 행 트리거를 지나간다 (004_shipment_work.sql) ──
  PERFORM ft_shipment_work_enter();

  -- ── 1) 대상 박스 검증 + 공유 잠금 ──
  SELECT * INTO v_box FROM ft_box_info WHERE id = p_box_info_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_BOX_NOT_FOUND';
  END IF;
  IF v_box.user_id IS DISTINCT FROM p_user_id
     OR v_box.shipment_id IS NOT NULL
     OR v_box.status IS DISTINCT FROM 'PACKING' THEN
    RAISE EXCEPTION 'MOVE_BOX_NOT_OPEN';
  END IF;

  -- ── 2) 원본 행 검증 + 배타 잠금 ──
  SELECT * INTO v_src FROM ft_fulfillment_outbounds WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MOVE_ROW_NOT_FOUND';
  END IF;
  IF v_src.type IS DISTINCT FROM 'PACKED'
     OR v_src.shipment_id IS NOT NULL
     OR v_src.user_id IS DISTINCT FROM p_user_id
     OR COALESCE(v_src.quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'MOVE_ROW_NOT_MOVABLE';
  END IF;

  -- ── 3) 이미 대상 박스 ──
  IF v_src.box_info_id = p_box_info_id THEN
    RETURN QUERY SELECT 'SKIPPED'::text, v_src.id, 0;
    RETURN;
  END IF;

  -- ── 4) 수량 검증 (DB 수량 기준) ──
  IF p_qty IS NOT NULL AND (p_qty <= 0 OR p_qty > v_src.quantity) THEN
    RAISE EXCEPTION 'MOVE_INVALID_QTY';
  END IF;

  v_trace := format(
    '[%s] %s → %s 이동 %s개',
    to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
    COALESCE(v_src.box_code, '-'),
    v_box.box_code,
    COALESCE(p_qty, v_src.quantity)
  );

  -- ── 5-a) 전체 이동 ──
  IF p_qty IS NULL OR p_qty = v_src.quantity THEN
    UPDATE ft_fulfillment_outbounds
       SET box_code    = v_box.box_code,
           box_info_id = v_box.id,
           note        = concat_ws(' | ', NULLIF(v_src.note, ''), v_trace)
     WHERE id = p_id;
    RETURN QUERY SELECT 'FULL'::text, p_id, v_src.quantity;
    RETURN;
  END IF;

  -- ── 5-b) 분할 이동 — 원본 차감 + 새 행 (같은 트랜잭션) ──
  UPDATE ft_fulfillment_outbounds
     SET quantity = quantity - p_qty
   WHERE id = p_id;

  INSERT INTO ft_fulfillment_outbounds (
    created_at, order_item_id, manual_item_id, type, quantity, note,
    order_no, product_no, product_id,
    box_code, box_info_id,
    operator_id, operator_name, user_id
  ) VALUES (
    v_src.created_at, v_src.order_item_id, v_src.manual_item_id, 'PACKED', p_qty,
    concat_ws(' | ', NULLIF(v_src.note, ''), v_trace),
    v_src.order_no, v_src.product_no, v_src.product_id,
    v_box.box_code, v_box.id,
    v_src.operator_id, v_src.operator_name, v_src.user_id
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT 'SPLIT'::text, v_new_id, p_qty;
END;
$$;

-- ============================================================
-- 6) 와우출고 [출고준비완료] · [바로 출고준비] · [출고준비 취소] — 쉽먼트 작업 중이면 거절
--   출고준비는 박스를 출고 대기 목록에 넣고, 취소는 목록에서 뺀다 (포장 행은 그대로라 트리거가 보지 못한다)
--   008_wow_ready.sql 의 ft_wow_ready_set · 010_wow_flow.sql 의 ft_wow_ready_pack 과 같고, 확인 한 줄이 늘었다
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_wow_ready_set(
  p_wow_box_ids   uuid[],
  p_ready         boolean,
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids   uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_order record;
BEGIN
  IF p_ready IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  FOR v_order IN
    SELECT DISTINCT user_id, order_number FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY user_id, order_number
  LOOP
    PERFORM ft_wow_lock(v_order.user_id, v_order.order_number, '{}'::uuid[]);
    -- 쉽먼트 작업 중이면 출고 대기 목록에 넣거나 뺄 수 없다 (SHIPMENT_WORK_LOCKED)
    PERFORM ft_shipment_work_assert_closed(v_order.user_id);
  END LOOP;

  -- ── 잠금 뒤 읽기 (로켓 동기화 · 다른 창의 취소 · 출고준비와 겨룬다) ──
  PERFORM 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'WOW_BOX_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_boxes b
              JOIN ft_fulfillment_outbounds o ON o.box_info_id = b.box_info_id AND o.shipment_id IS NOT NULL
             WHERE b.id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'WOW_BOX_SHIPPED';
  END IF;
  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (ready_at IS NOT NULL) = p_ready) THEN
    RAISE EXCEPTION '%', CASE WHEN p_ready THEN 'WOW_READY_ALREADY' ELSE 'WOW_NOT_READY' END;
  END IF;
  IF p_ready AND EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids)
                          AND (box_info_id IS NULL OR label_path IS NULL OR manifest_path IS NULL)) THEN
    RAISE EXCEPTION 'WOW_DOCS_NOT_READY';
  END IF;

  UPDATE ft_wow_boxes
     SET ready_at   = CASE WHEN p_ready THEN now() END,
         ready_by   = CASE WHEN p_ready THEN p_operator_name END,
         updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN jsonb_build_object('count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.ft_wow_ready_pack(
  p_wow_box_ids   uuid[],
  p_operator_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ids       uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(p_wow_box_ids) u WHERE u IS NOT NULL);
  v_user      uuid;
  v_user_code text;
  v_group     record;
  v_cartons   uuid[];
  v_carton    uuid;
  v_code      text;
  v_no        int;
  v_out       jsonb := '[]';
BEGIN
  IF COALESCE(cardinality(v_ids), 0) = 0
     OR (SELECT count(DISTINCT user_id) FROM ft_wow_boxes WHERE id = ANY (v_ids)) <> 1 THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;
  SELECT DISTINCT user_id INTO v_user FROM ft_wow_boxes WHERE id = ANY (v_ids);
  SELECT NULLIF(trim(user_code), '') INTO v_user_code FROM ft_users WHERE id = v_user;
  IF v_user_code IS NULL THEN
    RAISE EXCEPTION 'WOW_INVALID_INPUT';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('ft_wow_pack:' || v_user::text));
  PERFORM ft_wow_lock_boxes(v_ids);
  -- 쉽먼트 작업 중이면 출고 대기 목록에 넣을 수 없다 (SHIPMENT_WORK_LOCKED)
  PERFORM ft_shipment_work_assert_closed(v_user);

  IF EXISTS (SELECT 1 FROM ft_wow_boxes WHERE id = ANY (v_ids) AND (packed_at IS NULL OR ready_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'WOW_NOT_PACKED';
  END IF;
  -- 마대는 통째로: 같은 마대에 아직 출고준비 전인 박스가 남으면 거절 (먼저 출고준비된 박스는 이미 그 마대 상자에 묶여 있다)
  IF EXISTS (SELECT 1 FROM ft_wow_boxes b
              WHERE b.bag_id IN (SELECT bag_id FROM ft_wow_boxes WHERE id = ANY (v_ids) AND bag_id IS NOT NULL)
                AND b.ready_at IS NULL AND b.id <> ALL (v_ids)) THEN
    RAISE EXCEPTION 'WOW_BAG_PARTIAL';
  END IF;

  PERFORM set_config('ft.wow', 'on', true);

  FOR v_group IN
    SELECT array_agg(b.id) AS ids, MIN(b.bag_id::text)::uuid AS bag_id
      FROM ft_wow_boxes b
     WHERE b.id = ANY (v_ids)
     GROUP BY COALESCE(b.bag_id, b.id)
     ORDER BY MIN(b.ship_seq), MIN(b.id::text)
  LOOP
    -- 이미 있는 마킹 상자 = 묶음 안 박스의 상자 + 같은 마대에서 먼저 출고준비된 박스의 상자
    v_cartons := ARRAY(SELECT DISTINCT m.box_info_id FROM ft_wow_boxes m
                        WHERE m.box_info_id IS NOT NULL
                          AND (m.id = ANY (v_group.ids) OR m.bag_id = v_group.bag_id));
    IF cardinality(v_cartons) > 1 THEN
      RAISE EXCEPTION 'WOW_INVALID_INPUT';
    END IF;

    IF cardinality(v_cartons) = 1 THEN
      v_carton := v_cartons[1];
      SELECT box_code INTO v_code FROM ft_box_info WHERE id = v_carton;
    ELSE
      -- 번호 칸(no)은 글자다 — 숫자만 읽는다. 같은 코드의 출고 전 박스가 있으면 건너뛴다
      SELECT COALESCE(MAX(NULLIF(regexp_replace(COALESCE(no, ''), '\D', '', 'g'), '')::int), 0) INTO v_no
        FROM ft_box_info
       WHERE user_id = v_user AND type = 'X' AND shipment_id IS NULL;
      LOOP
        v_no   := v_no + 1;
        v_code := v_user_code || '-X-' || lpad(v_no::text, 2, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM ft_box_info WHERE user_id = v_user AND box_code = v_code AND shipment_id IS NULL);
      END LOOP;
      INSERT INTO ft_box_info (user_code, box_code, type, no, status, user_id)
      VALUES (v_user_code, v_code, 'X', lpad(v_no::text, 2, '0'), 'PACKING', v_user)
      RETURNING id INTO v_carton;
    END IF;

    UPDATE ft_fulfillment_outbounds
       SET box_info_id = v_carton, box_code = v_code
     WHERE id IN (SELECT outbound_id FROM ft_wow_items WHERE wow_box_id = ANY (v_group.ids) AND outbound_id IS NOT NULL)
       AND box_info_id IS DISTINCT FROM v_carton;

    UPDATE ft_wow_boxes
       SET box_info_id = v_carton, ready_at = now(), ready_by = p_operator_name, updated_at = now()
     WHERE id = ANY (v_group.ids);

    v_out := v_out || jsonb_build_object('box_code', v_code, 'boxes', cardinality(v_group.ids));
  END LOOP;

  PERFORM set_config('ft.wow', '', true);
  RETURN jsonb_build_object('count', cardinality(v_ids), 'cartons', v_out);
END;
$$;

-- ── 확인 ──
-- SELECT u.user_code, w.* FROM public.ft_shipment_works w JOIN public.ft_users u ON u.id = w.user_id ORDER BY w.started_at DESC LIMIT 20;

-- ── 풀기 (작업이 걸린 채 화면으로 풀 수 없을 때) ──
-- SELECT public.ft_shipment_work_end('<user_id>', 'CANCELLED', '관리자');

-- ── 롤백 ──
--   DROP TRIGGER IF EXISTS ft_shipment_work_guard ON public.ft_fulfillment_outbounds;
--   ft_shipment_manual_create · ft_move_outbound 는 003_manual_shipment_item.sql, ft_wow_ready_set 은 008_wow_ready.sql,
--   ft_wow_ready_pack 은 010_wow_flow.sql 을 다시 실행
--   DROP FUNCTION IF EXISTS public.ft_shipment_work_guard(), public.ft_shipment_work_start(uuid, text),
--     public.ft_shipment_work_end(uuid, text, text, uuid), public.ft_shipment_work_enter(), public.ft_shipment_work_assert_closed(uuid);
--   DROP TABLE IF EXISTS public.ft_shipment_works;
