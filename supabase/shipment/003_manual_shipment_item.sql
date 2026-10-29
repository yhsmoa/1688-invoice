-- ============================================================
-- 쉽먼트 V2 [생성] — 부자재 등 주문 없는 수동 쉽먼트 행
--
-- 왜 ft_order_items 에 넣지 않나
--   주문 항목 표는 고객 진행상황('전체' 탭)·장바구니 불러오기·1688 주문번호 매칭·
--   품목 분류 캐시·처리속도 통계가 모두 읽는다. 주문이 아닌 부자재를 넣으면 그 화면들에
--   새어 나간다 (docs/PLAN_shipment-v2_redesign_move-requests.md §4 감사표).
--
-- 구조
--   ft_shipment_manual_items       : 부자재 정보 (화면의 주문번호·바코드·상품정보·주문옵션·
--                                    단가·품목·쉽먼트사이즈·입고)
--   ft_fulfillment_outbounds       : 기존 포장(PACKED) 행 그대로 — order_item_id = NULL,
--     .manual_item_id (신규 컬럼)    manual_item_id 로 부자재를 가리킨다.
--   → 박스 이동·합배송·출고·박스라벨·출고완료 스냅샷은 포장 행 기준이라 그대로 동작.
--
-- 함수
--   ft_shipment_manual_create : 부자재 1행 + 포장 1행을 한 트랜잭션으로 (service role 전용)
--   ft_move_outbound          : 분할 이동 시 manual_item_id 도 복사하도록 갱신
--
-- 권한: 부자재 표는 RLS 켜고 anon/authenticated SELECT 정책만 (004 파일) — 쓰기는 함수로만
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-10-29)
-- ============================================================

-- ============================================================
-- 1) 부자재 표
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ft_shipment_manual_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid        NOT NULL,
  product_no       text        NOT NULL,
  barcode          text,
  item_name        text        NOT NULL,
  china_option     text,
  price_cny        numeric     CHECK (price_cny IS NULL OR price_cny >= 0),
  customs_category text,
  size_code        text        NOT NULL CHECK (size_code IN ('A','B','C','P','X')),
  arrival_qty      integer     NOT NULL CHECK (arrival_qty > 0),
  created_by       text
);

COMMENT ON TABLE public.ft_shipment_manual_items IS
  '쉽먼트 V2 [생성] 으로 추가한 주문 없는 쉽먼트 품목(부자재 등). 포장 행은 ft_fulfillment_outbounds.manual_item_id 로 연결';

CREATE INDEX IF NOT EXISTS ft_shipment_manual_items_user_idx
  ON public.ft_shipment_manual_items (user_id);

ALTER TABLE public.ft_shipment_manual_items ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ft_shipment_manual_items FROM anon, authenticated;

-- ============================================================
-- 2) 포장 행 → 부자재 연결 컬럼
-- ============================================================
ALTER TABLE public.ft_fulfillment_outbounds
  ADD COLUMN IF NOT EXISTS manual_item_id uuid
  REFERENCES public.ft_shipment_manual_items (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ft_fulfillment_outbounds_manual_item_idx
  ON public.ft_fulfillment_outbounds (manual_item_id) WHERE manual_item_id IS NOT NULL;

-- ============================================================
-- 3) 수동 행 생성 (service role 전용)
--
--   p_item: { product_no, barcode, item_name, china_option, price_cny, customs_category, size_code }
--   검증: 박스(같은 user · PACKING · 미출고, FOR SHARE) / 1 ≤ 스캔 ≤ 입고 / 필수 문자열
--   반환: { manual_item_id, outbound_id, box_code }
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

REVOKE ALL ON FUNCTION public.ft_shipment_manual_create(uuid, uuid, jsonb, int, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ft_shipment_manual_create(uuid, uuid, jsonb, int, int, text)
  TO service_role;

-- ============================================================
-- 4) ft_move_outbound 갱신 — 분할 이동 새 행에 manual_item_id 복사
--    (supabase/shipment/001_move_outbound.sql 과 동일, INSERT 컬럼만 추가)
-- ============================================================
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

REVOKE ALL ON FUNCTION public.ft_move_outbound(uuid, uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;
