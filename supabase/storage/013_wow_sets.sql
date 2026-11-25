-- ============================================================
-- 와우출고 — 세트 상품도 대상에 넣는다 + 로켓 사입관리 '주문' 이 창고에 들어온 수량을 빼도록 값 제공
--   앞 단계: supabase/storage/005_wow.sql (ft_wow_candidates · ft_wow_available) · 012_wow_cancel.sql
--
-- 1) ft_wow_candidates — "세트 아님" 조건을 없앤다 (2026-11-26 사용자 결정: 세트도 재고로 세야 한다)
--    재고 원장은 처음부터 상품(product_id) 단위, 1세트 = 1 이다 (001_storage.sql). 꺼내기(ft_wow_pick · ft_wow_pick_found ·
--    ft_wow_cancel)도 세트의 대표 행(set_seq NULLS FIRST, item_no)으로 기록하게 돼 있어 세트를 그대로 담을 수 있다.
--    빠져 있던 것은 "바코드 → 대상 상품" 정의뿐이라, 세트는 창고에 있어도 로켓의 🇨🇳 재고 · [배정] 에 잡히지 않았다.
--    바뀌는 점:
--      · 상품마다 대표 행 1개의 바코드를 쓴다 (꺼내기와 같은 대표 행 규칙).
--        세트 구성품끼리 바코드가 다르게 적혀 있어도 한 상품이 두 바코드에 잡히지 않는다
--      · 단품은 그대로다 — 적용 전 운영 DB 에서 옛 정의와 새 정의를 비교했다: 917 → 918, 늘어난 1개가 세트 상품 (빠진 것 없음)
--
-- 2) ft_storage_inhouse — 보관 상품의 "창고에 들어와 있는 수량" (상품 단위). 로켓 사입관리 '주문'(위해 📦) 계산용
--    로켓의 '주문' = 주문 − 취소/반품 − 출고완료 였다. 보관 상품은 창고에 넣은 뒤에도 출고될 때까지 진행중이라
--    같은 물건이 '주문' 과 🇨🇳 재고에 두 번 잡혔다. 로켓이 아래 두 값을 더 뺀다:
--      stocked    = 지금 창고에 있는 수량 = Σ 원장 delta (배치 − 꺼냄 + 포장철회).
--                   수량 수정(ADJUST)은 뺀다 — 잃어버려서 줄인 수량이 "아직 올 주문" 으로 되살아나면 안 된다
--      wow_packed = 와우 박스에 담았고 아직 출고 안 된 수량 (포장 행에 shipment_id 없음).
--                   로켓에서는 이미 발주서에 배정된 수량이라 '주문' 으로 또 세면 안 된다
--    이렇게 하면 '주문' 에 남는 것 = 아직 창고에 안 들어온 수량 + 일반 박스에 담고 아직 안 나간 수량 (예전 기준 그대로)
--
-- 적용: 2026-11-26 (운영 DB mkcxpkblohioqboemmah). 적용 뒤 확인 — 세트 바코드가 ft_wow_available 에 나온다(재고 0),
--   로켓의 새 '주문' 합이 같은 식을 SQL 로 계산한 값과 같다(9,023 → 6,133).
--   세트를 실제로 와우 박스에 담는 것은 시험하지 못했다 — 창고에 들어온 세트가 아직 없다
--
-- 권한: ft_wow_candidates 는 그대로(service role 전용, CREATE OR REPLACE 는 권한을 유지한다).
--       ft_storage_inhouse 는 로켓(anon 키)이 부른다 — ft_wow_available 과 같은 방식(SECURITY DEFINER)
-- ============================================================

-- ============================================================
-- 1) 와우 대상 상품 — 바코드 → product_id 의 유일한 정의
--   보관(STOCK) · DONE 아님 · 바코드 있음. 세트는 대표 행(set_seq NULLS FIRST, item_no)의 바코드
--   한 바코드에 여럿이면 먼저 배치된 순 → product_id 순
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
      SELECT trim(r.barcode) AS barcode, r.product_id
        FROM (
          SELECT DISTINCT ON (oi.product_id) oi.product_id, oi.barcode
            FROM ft_order_items oi
           WHERE oi.user_id = p_user_id
             AND oi.arrival_route = 'STOCK'
             AND oi.status IS DISTINCT FROM 'DONE'
             AND oi.product_id IS NOT NULL
           ORDER BY oi.product_id, oi.set_seq NULLS FIRST, oi.item_no
        ) r
       WHERE NULLIF(trim(r.barcode), '') IS NOT NULL
    ) c
    LEFT JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at
        FROM ft_storage_movements m
       WHERE m.user_id = p_user_id AND m.product_id = c.product_id AND m.kind = 'PUTAWAY'
    ) f ON true;
$$;

-- ============================================================
-- 2) 창고에 들어와 있는 수량 (로켓 사입관리 '주문' 계산)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ft_storage_inhouse(p_user_id uuid)
RETURNS TABLE (product_id uuid, stocked int, wow_packed int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.product_id, SUM(s.stocked)::int, SUM(s.wow_packed)::int
    FROM (
      SELECT m.product_id, m.delta AS stocked, 0 AS wow_packed
        FROM ft_storage_movements m
       WHERE m.user_id = p_user_id AND m.kind <> 'ADJUST'
      UNION ALL
      SELECT o.product_id, 0, o.quantity
        FROM ft_fulfillment_outbounds o
       WHERE o.user_id = p_user_id AND o.type = 'PACKED' AND o.shipment_id IS NULL
         AND o.product_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM ft_wow_items i WHERE i.outbound_id = o.id)
    ) s
   GROUP BY s.product_id
  HAVING SUM(s.stocked) <> 0 OR SUM(s.wow_packed) <> 0;
$$;

REVOKE ALL ON FUNCTION public.ft_storage_inhouse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ft_storage_inhouse(uuid) TO anon, authenticated, service_role;

-- ── 확인 ──
-- SELECT * FROM public.ft_wow_available('<user_id>') WHERE barcode = '<세트 바코드>';
-- SELECT * FROM public.ft_storage_inhouse('<user_id>');

-- ── 롤백 ──
--   DROP FUNCTION IF EXISTS public.ft_storage_inhouse(uuid);   -- 로켓 routes/rkWeihai.js 를 먼저 되돌린 뒤
--   ft_wow_candidates 는 005_wow.sql 의 정의를 다시 실행 (세트가 와우 박스에 잡혀 있지 않을 때만)
