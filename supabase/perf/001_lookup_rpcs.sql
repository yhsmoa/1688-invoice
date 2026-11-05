-- ============================================================
-- 조회 왕복 줄이기 — 상품입고 V2/V3 · 주문현황 V2 · 상품출고 V2 가 쓰는 세 조회를 RPC 1회로
--
--   Railway(싱가포르) ↔ Supabase(서울) 는 PostgREST 호출 1회에 200ms 안팎이 든다.
--   2026-11-05 운영 측정(설온 BO, 진행중 1,658행):
--     · /api/ft/fulfillments   입출고 이력을 100건씩 25번 순차 호출 → 5.9초
--     · /api/ft/order-items    1000행 페이지 2번                     → 2.2초 (2.1MB 무압축)
--     · by-delivery-code       배송번호 → 주문ID → 주문행 2번        → 1.0초
--   행이 늘수록 호출 횟수가 같이 늘어 느려지므로, 배열 인자를 받아 한 번에 돌려주는 함수로 바꾼다.
--
--   · 반환은 json 스칼라 — PostgREST 의 max-rows(1000) 제한을 받지 않는다 (setof 가 아니므로).
--     jsonb 가 아니라 json 인 이유: 25,000행(ALL 탭) 기준 json_agg 0.9초 / jsonb_agg 1.5초 /
--     jsonb 로 컬럼까지 고르면 4.1초. 컬럼 고르기는 라우트(TypeScript)가 한다 —
--     목록의 기준은 여전히 lib/ftOrderItemsSelect.ts 하나.
--   · 정렬은 기존 PostgREST .order('item_no') 와 같은 item_no ASC (NULLS LAST).
--   · SECURITY INVOKER(기본). anon/authenticated 는 실행 불가 — 서버(service_role)만 호출한다.
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah)
-- ============================================================

-- ── 1) 인덱스 — 배송번호 조회 두 단계 모두 순차 스캔이었다 ──
--    ft_order_items."1688_order_id" (42,295행)  ·  deliveryInfo_check.delivery_code (8,885행)
CREATE INDEX IF NOT EXISTS idx_ft_order_items_1688_order_id
  ON public.ft_order_items ("1688_order_id");
CREATE INDEX IF NOT EXISTS idx_1688_invoice_delivery_check_code
  ON public."1688_invoice_deliveryInfo_check" (delivery_code);

-- ── 2) 사용자 + 상태로 주문행 전체 (status 'ALL' 또는 NULL 이면 상태 필터 없음) ──
DROP FUNCTION IF EXISTS public.ft_order_items_by_user(uuid, text, text[]);
CREATE OR REPLACE FUNCTION public.ft_order_items_by_user(
  p_user_id uuid,
  p_status  text DEFAULT 'PROCESSING'
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    json_agg(to_json(oi) ORDER BY oi.item_no ASC NULLS LAST),
    '[]'::json)
  FROM public.ft_order_items oi
  WHERE oi.user_id = p_user_id
    AND (p_status IS NULL OR p_status = 'ALL' OR oi.status = p_status)
$$;

-- ── 3) 배송번호 → (deliveryInfo_check.order_id) → ft_order_items."1688_order_id" ──
DROP FUNCTION IF EXISTS public.ft_order_items_by_delivery_code(text, text[]);
CREATE OR REPLACE FUNCTION public.ft_order_items_by_delivery_code(
  p_delivery_code text
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    json_agg(to_json(oi) ORDER BY oi.item_no ASC NULLS LAST),
    '[]'::json)
  FROM public.ft_order_items oi
  WHERE oi."1688_order_id" IN (
    SELECT d.order_id
    FROM public."1688_invoice_deliveryInfo_check" d
    WHERE d.delivery_code = p_delivery_code
      AND d.order_id IS NOT NULL
  )
$$;

-- ── 4) 입출고 이력 — inbound 는 order_item_id 기준, outbound 는
--       product_ids + user_id 가 오면 그 기준(같은 product_id 를 공유하는 형제 행의 PACKED 포함),
--       아니면 order_item_id 기준 (/api/ft/fulfillments POST 조회 모드와 동일 규칙) ──
DROP FUNCTION IF EXISTS public.ft_fulfillments_lookup(uuid[], uuid[], uuid);
CREATE OR REPLACE FUNCTION public.ft_fulfillments_lookup(
  p_order_item_ids uuid[],
  p_product_ids    uuid[] DEFAULT NULL,
  p_user_id        uuid   DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'inbound', COALESCE((
      SELECT json_agg(json_build_object(
        'id', i.id, 'order_item_id', i.order_item_id, 'quantity', i.quantity, 'type', i.type,
        'created_at', i.created_at, 'operator_name', i.operator_name, 'product_id', i.product_id))
      FROM public.ft_fulfillment_inbounds i
      WHERE i.order_item_id = ANY (p_order_item_ids)
    ), '[]'::json),
    'outbound', COALESCE((
      SELECT json_agg(json_build_object(
        'id', o.id, 'order_item_id', o.order_item_id, 'quantity', o.quantity, 'type', o.type,
        'created_at', o.created_at, 'operator_name', o.operator_name, 'product_id', o.product_id,
        'shipment_id', o.shipment_id))
      FROM public.ft_fulfillment_outbounds o
      WHERE CASE
        WHEN p_product_ids IS NOT NULL AND cardinality(p_product_ids) > 0 AND p_user_id IS NOT NULL
          THEN o.product_id = ANY (p_product_ids) AND o.user_id = p_user_id
        ELSE o.order_item_id = ANY (p_order_item_ids)
      END
    ), '[]'::json)
  )
$$;

-- 처음 적용 때 썼던 jsonb 컬럼 고르기 함수 — 느려서 뺐다
DROP FUNCTION IF EXISTS public.ft_jsonb_pick(jsonb, text[]);

-- ── 5) 권한 — 서버(service_role)만 ──
REVOKE ALL ON FUNCTION public.ft_order_items_by_user(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_order_items_by_delivery_code(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ft_fulfillments_lookup(uuid[], uuid[], uuid)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ft_order_items_by_user(uuid, text)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.ft_order_items_by_delivery_code(text)       TO service_role;
GRANT  EXECUTE ON FUNCTION public.ft_fulfillments_lookup(uuid[], uuid[], uuid) TO service_role;
