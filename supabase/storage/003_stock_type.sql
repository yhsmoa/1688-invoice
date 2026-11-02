-- ============================================================
-- S(보관) 타입 — 박스 타입을 "꺼낼 때" 정한다 + 고객 쉽먼트 요청
--   계획: D:\project\purchase-agent\docs\PLAN_stock-type-S.md (§1·§2 결정)
--
-- 모델
--   · S 상품 = arrival_route='STOCK' 이고 shipment_type 이 NULL 인 상품.
--     coupang_shipment_size · personal_order_no 는 알고 있으면 보존 (COUPANG 으로 꺼낼 때 바로 A/B/C).
--   · 타입(COUPANG/PERSONAL/DIRECT)은 재고에서 꺼낼 때 정한다 — 고객 요청 또는 창고 직접.
--     정해지면 상품(product_id) 전체 행에 기록 → 그 뒤는 일반 상품과 같다 (쉽먼트 V2 검증·통관·DONE).
--   · 잠금: 미출고 PACKED 행이 있는 동안은 다른 타입으로 꺼낼 수 없다 (STOCK_TYPE_LOCKED).
--
-- 권한: 요청 생성/취소는 anon(고객) SECURITY DEFINER, 나머지는 service role 전용.
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-02)
-- ============================================================

-- ============================================================
-- 1) 고객 쉽먼트 요청
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_storage_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL,
  product_id            uuid        NOT NULL,
  qty                   int         NOT NULL CHECK (qty > 0),
  shipment_type         text        NOT NULL CHECK (shipment_type IN ('COUPANG','PERSONAL','DIRECT')),
  coupang_shipment_size text,
  personal_order_no     text,
  status                text        NOT NULL DEFAULT 'REQUESTED'
                                    CHECK (status IN ('REQUESTED','DONE','CANCELLED')),
  requested_by          text,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  done_by               text,
  done_at               timestamptz,
  done_outbound_id      uuid,
  note                  text
);

COMMENT ON TABLE public.ft_storage_requests IS
  '고객 재고 쉽먼트 요청 — 상품(product_id)당 미처리 1건. 쓰기는 ft_storage_request_* 함수와 pick 함수로만';

CREATE INDEX IF NOT EXISTS ft_storage_requests_user_status_idx
  ON public.ft_storage_requests (user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ft_storage_requests_open_uniq
  ON public.ft_storage_requests (product_id) WHERE status = 'REQUESTED';

ALTER TABLE public.ft_storage_requests DISABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_storage_requests FROM anon, authenticated;
GRANT SELECT ON public.ft_storage_requests TO anon, authenticated;

-- ============================================================
-- 2) 타입 확정 — 요청 검증과 pick 이 같은 규칙을 쓴다
--   p_apply=false : 검증만 (요청 생성)  /  true : 상품 전체 행에 기록 (pick)
--   반환 { shipment_type, coupang_shipment_size, personal_order_no }
--   오류 STOCK_TYPE_REQUIRED / STOCK_SIZE_REQUIRED / STOCK_PERSONAL_NO_REQUIRED / STOCK_TYPE_LOCKED
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_resolve_type(
  p_user_id           uuid,
  p_product_id        uuid,
  p_shipment_type     text,
  p_size              text,
  p_personal_order_no text,
  p_apply             boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cur_type text;
  v_cur_size text;
  v_cur_pno  text;
  v_type     text := upper(trim(COALESCE(p_shipment_type, '')));
  v_size     text := NULLIF(trim(COALESCE(p_size, '')), '');
  v_pno      text := NULLIF(trim(COALESCE(p_personal_order_no, '')), '');
  v_open     boolean;
BEGIN
  -- ── 현재 값 (세트는 모든 행이 같다 — 대표 1행) ──
  SELECT shipment_type, coupang_shipment_size, personal_order_no
    INTO v_cur_type, v_cur_size, v_cur_pno
    FROM ft_order_items
   WHERE user_id = p_user_id AND product_id = p_product_id
   ORDER BY set_seq NULLS FIRST, item_no
   LIMIT 1;

  IF v_type = '' THEN v_type := COALESCE(v_cur_type, ''); END IF;
  IF v_type NOT IN ('COUPANG','PERSONAL','DIRECT') THEN
    RAISE EXCEPTION 'STOCK_TYPE_REQUIRED';
  END IF;

  IF v_type = 'COUPANG' THEN
    v_size := COALESCE(v_size, v_cur_size);
    IF v_size IS NULL OR lower(v_size) NOT IN ('small','medium','large') THEN
      RAISE EXCEPTION 'STOCK_SIZE_REQUIRED';
    END IF;
  ELSE
    v_size := NULL;
  END IF;

  IF v_type = 'PERSONAL' THEN
    v_pno := COALESCE(v_pno, v_cur_pno);
    IF v_pno IS NULL THEN
      RAISE EXCEPTION 'STOCK_PERSONAL_NO_REQUIRED';
    END IF;
  ELSE
    v_pno := NULL;
  END IF;

  -- ── 잠금: 이미 타입이 있고 미출고 PACKED 행이 있으면 다른 타입 불가 ──
  IF v_cur_type IS NOT NULL
     AND (v_type <> v_cur_type
          OR (v_type = 'COUPANG' AND lower(v_size) IS DISTINCT FROM lower(v_cur_size))) THEN
    SELECT EXISTS (
      SELECT 1 FROM ft_fulfillment_outbounds
       WHERE user_id = p_user_id AND product_id = p_product_id
         AND type = 'PACKED' AND shipment_id IS NULL
    ) INTO v_open;
    IF v_open THEN
      RAISE EXCEPTION 'STOCK_TYPE_LOCKED';
    END IF;
  END IF;

  -- ── 기록 (상품 전체 행) — 바뀌는 값만, 보존값은 유지 ──
  IF p_apply THEN
    UPDATE ft_order_items
       SET shipment_type         = v_type,
           coupang_shipment_size = CASE WHEN v_type = 'COUPANG' THEN v_size ELSE coupang_shipment_size END,
           personal_order_no     = CASE WHEN v_type = 'PERSONAL' THEN v_pno ELSE personal_order_no END
     WHERE user_id = p_user_id AND product_id = p_product_id
       AND (shipment_type IS DISTINCT FROM v_type
            OR (v_type = 'COUPANG' AND coupang_shipment_size IS DISTINCT FROM v_size)
            OR (v_type = 'PERSONAL' AND personal_order_no IS DISTINCT FROM v_pno));
  END IF;

  RETURN jsonb_build_object(
    'shipment_type', v_type,
    'coupang_shipment_size', v_size,
    'personal_order_no', v_pno
  );
END;
$$;

-- ============================================================
-- 3) 요청 생성 / 취소 (고객 — anon)
--   오류 REQUEST_NOT_STOCK / REQUEST_INVALID_QTY / REQUEST_EXISTS / STOCK_* (타입 검증)
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
  v_balance int;
  v_type    jsonb;
  v_id      uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

  IF NOT EXISTS (
    SELECT 1 FROM ft_order_items
     WHERE user_id = p_user_id AND product_id = p_product_id
       AND arrival_route = 'STOCK' AND status IS DISTINCT FROM 'DONE'
  ) THEN
    RAISE EXCEPTION 'REQUEST_NOT_STOCK';
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM ft_storage_movements
   WHERE user_id = p_user_id AND product_id = p_product_id;
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > v_balance THEN
    RAISE EXCEPTION 'REQUEST_INVALID_QTY';
  END IF;

  IF EXISTS (SELECT 1 FROM ft_storage_requests WHERE product_id = p_product_id AND status = 'REQUESTED') THEN
    RAISE EXCEPTION 'REQUEST_EXISTS';
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

CREATE OR REPLACE FUNCTION public.ft_storage_request_cancel(p_user_id uuid, p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ft_storage_requests
     SET status = 'CANCELLED', done_at = now(), note = 'cancelled by customer'
   WHERE id = p_request_id AND user_id = p_user_id AND status = 'REQUESTED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
END;
$$;

-- ============================================================
-- 4) 재고 → 쉽먼트 (PICK + PACKED) — 타입 확정 추가
--   001 의 7-인자 판을 지우고 10-인자 판으로 교체 (호출: /api/ft/storage/pick)
--   p_shipment_type 이 NULL 이면 상품의 기존 타입을 쓴다 (없으면 STOCK_TYPE_REQUIRED)
--   같은 상품의 REQUESTED 요청은 DONE 으로
-- ============================================================
DROP FUNCTION IF EXISTS public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean);

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
  PERFORM pg_advisory_xact_lock(hashtext('ft_storage:' || p_product_id::text));

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

  -- ── 타입 확정 (상품 전체 행 기록) — 인자가 없으면 미처리 고객 요청의 타입을 쓴다 ──
  IF NULLIF(trim(COALESCE(p_shipment_type, '')), '') IS NULL THEN
    SELECT shipment_type, coupang_shipment_size, personal_order_no
      INTO p_shipment_type, p_size, p_personal_order_no
      FROM ft_storage_requests
     WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED'
     LIMIT 1;
  END IF;
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

  -- ── 고객 요청 처리완료 ──
  UPDATE ft_storage_requests
     SET status = 'DONE', done_by = p_operator_name, done_at = now(), done_outbound_id = v_out_id
   WHERE user_id = p_user_id AND product_id = p_product_id AND status = 'REQUESTED';

  RETURN jsonb_build_object('outbound_id', v_out_id, 'box_code', v_box.box_code, 'picked', v_total) || v_type;
END;
$$;

-- ============================================================
-- 5) 검수 확인 size_code 에 S — 보관 상품은 입고 때 타입이 없다
-- ============================================================
ALTER TABLE public.ft_customer_checks DROP CONSTRAINT IF EXISTS ft_customer_checks_size_code_check;
ALTER TABLE public.ft_customer_checks
  ADD CONSTRAINT ft_customer_checks_size_code_check
  CHECK (size_code IS NULL OR size_code IN ('A','B','C','P','X','S'));

-- ============================================================
-- 6) 권한
-- ============================================================
REVOKE ALL ON FUNCTION public.ft_storage_resolve_type(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_storage_resolve_type(uuid, uuid, text, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.ft_storage_request_create(uuid, uuid, int, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_storage_request_create(uuid, uuid, int, text, text, text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ft_storage_request_cancel(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_storage_request_cancel(uuid, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_storage_pick_to_shipment(uuid, uuid, uuid, jsonb, uuid, text, boolean, text, text, text) TO service_role;
