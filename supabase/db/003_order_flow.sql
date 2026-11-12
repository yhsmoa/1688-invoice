-- ============================================================
-- 주문 진행 현황 — db_order_flow()
--
-- 화면: /db/orders (주문 데이터 관리) ← GET /api/db/order-weekly
--
-- 진행 순서: 주문 → 배송완료(1688) → 입고 → 출고
--   이 함수는 주문 1건(ft_orders)마다 품목 합계와 "어디까지 왔는지" 수량을 돌려준다.
--   기간(일/주/월) 버킷은 API 가 주문 생성일(KST)로 나눈다 (lib/periodBucket).
--
-- 품목(ft_order_items) 1행의 주문수량 q 를 아래 6칸으로 "겹치지 않게" 나눈다.
--   위에서부터 순서대로 채우고, 남은 수량만 다음 칸으로 넘긴다 → 6칸의 합 = q (항상).
--
--   1) arrived         입고완료      min(q, ARRIVAL 합)                — 실물 입고가 최우선
--   2) cancel_done     취소 완료     남은 수량 중 취소 DONE 수량
--   3) cancel_pending  취소 접수중   남은 수량 중 취소 접수(DONE 아님) 수량
--   --- 여기까지 빼고 남은 수량(rest) 은 품목 상태에 따라 한 칸으로 간다 ---
--   4) closed          기록 없이 종결  품목 status = 'DONE' (입고 기록 없이 완료 처리된 건)
--   5) waiting         입고대기      1688 배송완료 기록 있음, 아직 입고 전
--   6) undelivered     미도착        1688 배송완료 기록 없음 (배송 전·배송 중·기록 없음)
--
--   미입고 잔량(앞으로 들어올 수량) = waiting + undelivered
--   → 완료(DONE) 품목은 4) 로 가므로 잔량에 절대 잡히지 않는다
--     (완료율 100% 인데 미입고가 남는 모순 방지).
--
-- 기준
--   · 입고     : ft_fulfillment_inbounds.type = 'ARRIVAL' 수량 합. 초과 입고는 q 로 자른다.
--   · 취소     : ft_cancel_details 중 cancel_type = 'CANCEL' (NULL 은 CANCEL — API 와 같은 fallback).
--                RETURN 은 입고 후 반품이라 "입고완료" 에 그대로 남는다.
--                예전 데이터에는 입고 후 취소가 CANCEL 로 저장된 행이 있어
--                입고를 먼저 채운다 (입고 + 취소 > q 가 되지 않게).
--   · 배송완료 : im_1688_delivery_history.delivered_seen_at IS NOT NULL
--                (품목의 "1688_order_id" = history.order_no, order_no 는 PK 라 행이 늘지 않는다)
--                배송상황 CSV 업로드로만 갱신된다 → 마지막 업로드 시각을 함께 반환.
--
-- 반환: jsonb 1개
--   { orders: [주문별 합계 …], orphan_items: 주문 없는 품목 수, last_delivery_upload_at }
--   · 한 문장(단일 스냅샷)으로 계산 → 주문수량과 진행 수량이 서로 어긋나지 않는다.
--   · PostgREST 1000행 응답 제한을 피한다 (ft_order_items 4만 행을 내려받지 않는다).
--
-- 권한: service role 전용 / 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-12)
-- ============================================================

CREATE OR REPLACE FUNCTION public.db_order_flow()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH
-- ── 품목별 입고 수량 ──
arrivals AS (
  SELECT f.order_item_id, sum(f.quantity) AS qty
  FROM ft_fulfillment_inbounds f
  WHERE f.type = 'ARRIVAL' AND f.order_item_id IS NOT NULL
  GROUP BY f.order_item_id
),

-- ── 품목별 취소 수량 (입고 전 취소만 — RETURN 제외) ──
cancels AS (
  SELECT c.order_items_id AS order_item_id,
         sum(c.qty) FILTER (WHERE c.status = 'DONE')                AS done_qty,
         sum(c.qty) FILTER (WHERE c.status IS DISTINCT FROM 'DONE') AS pending_qty
  FROM ft_cancel_details c
  WHERE COALESCE(c.cancel_type, 'CANCEL') = 'CANCEL'
    AND c.order_items_id IS NOT NULL
  GROUP BY c.order_items_id
),

-- ── 1688 배송완료 주문 ──
delivered AS (
  SELECT h.order_no
  FROM im_1688_delivery_history h
  WHERE h.delivered_seen_at IS NOT NULL
),

-- ── 품목 원본 + 단계 판정 재료 (음수·NULL 은 0 으로) ──
item_base AS (
  SELECT i.id,
         i.order_id,
         i.shipment_type,
         COALESCE(i.order_qty, 0)                AS qty,
         COALESCE(i.price_total_cny, 0)          AS amount_cny,
         GREATEST(COALESCE(i.order_qty, 0), 0)   AS q,
         GREATEST(COALESCE(a.qty, 0), 0)         AS arr,
         GREATEST(COALESCE(c.done_qty, 0), 0)    AS c_done,
         GREATEST(COALESCE(c.pending_qty, 0), 0) AS c_pend,
         d.order_no IS NOT NULL                  AS is_delivered,
         COALESCE(i.status = 'DONE', false)      AS is_done
  FROM ft_order_items i
  LEFT JOIN arrivals a  ON a.order_item_id = i.id
  LEFT JOIN cancels c   ON c.order_item_id = i.id
  LEFT JOIN delivered d ON d.order_no = NULLIF(btrim(i."1688_order_id"), '')
),

-- ── 위에서부터 채우기: 입고 → 취소 완료 → 취소 접수중 → 나머지 ──
step_arrived AS (
  SELECT b.*, LEAST(b.q, b.arr) AS arrived
  FROM item_base b
),
step_cancel_done AS (
  SELECT s.*, LEAST(s.q - s.arrived, s.c_done) AS cancel_done
  FROM step_arrived s
),
step_cancel_pending AS (
  SELECT s.*, LEAST(s.q - s.arrived - s.cancel_done, s.c_pend) AS cancel_pending
  FROM step_cancel_done s
),
item_flow AS (
  SELECT s.*, s.q - s.arrived - s.cancel_done - s.cancel_pending AS rest
  FROM step_cancel_pending s
),

-- ── 주문별 합계 ──
per_order AS (
  SELECT f.order_id,
         count(*)                                                  AS item_rows,
         sum(f.qty)                                                AS qty,
         sum(f.qty) FILTER (WHERE f.shipment_type = 'COUPANG')     AS coupang_qty,
         sum(f.qty) FILTER (WHERE f.shipment_type = 'PERSONAL')    AS personal_qty,
         sum(f.qty) FILTER (WHERE f.shipment_type = 'DIRECT')      AS direct_qty,
         sum(f.qty) FILTER (WHERE f.is_done)                       AS done_qty,
         sum(f.amount_cny)                                         AS amount_cny,
         sum(f.arrived)                                            AS arrived_qty,
         sum(f.rest) FILTER (WHERE NOT f.is_done AND f.is_delivered)     AS waiting_qty,
         sum(f.rest) FILTER (WHERE NOT f.is_done AND NOT f.is_delivered) AS undelivered_qty,
         sum(f.cancel_done)                                        AS cancel_done_qty,
         sum(f.cancel_pending)                                     AS cancel_pending_qty,
         sum(f.rest) FILTER (WHERE f.is_done)                      AS closed_qty
  FROM item_flow f
  WHERE f.order_id IS NOT NULL
  GROUP BY f.order_id
)

SELECT jsonb_build_object(
  'orders', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id',                 o.id,
             'created_at',         o.created_at,
             'user_id',            o.user_id,
             'total_qty',          o.total_qty,
             'item_rows',          COALESCE(p.item_rows, 0),
             'qty',                COALESCE(p.qty, 0),
             'coupang_qty',        COALESCE(p.coupang_qty, 0),
             'personal_qty',       COALESCE(p.personal_qty, 0),
             'direct_qty',         COALESCE(p.direct_qty, 0),
             'done_qty',           COALESCE(p.done_qty, 0),
             'amount_cny',         COALESCE(p.amount_cny, 0),
             'arrived_qty',        COALESCE(p.arrived_qty, 0),
             'waiting_qty',        COALESCE(p.waiting_qty, 0),
             'undelivered_qty',    COALESCE(p.undelivered_qty, 0),
             'cancel_done_qty',    COALESCE(p.cancel_done_qty, 0),
             'cancel_pending_qty', COALESCE(p.cancel_pending_qty, 0),
             'closed_qty',         COALESCE(p.closed_qty, 0)
           ) ORDER BY o.id), '[]'::jsonb)
    FROM ft_orders o
    LEFT JOIN per_order p ON p.order_id = o.id
  ),
  -- 주문(ft_orders)이 없는 품목 — 어느 기간에도 넣을 수 없어 집계에서 빠진다
  'orphan_items', (
    SELECT count(*)
    FROM item_flow f
    WHERE f.order_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM ft_orders o WHERE o.id = f.order_id)
  ),
  'last_delivery_upload_at', (
    SELECT max(h.last_seen_at) FROM im_1688_delivery_history h
  )
)
$$;

REVOKE ALL ON FUNCTION public.db_order_flow()
  FROM PUBLIC, anon, authenticated;

-- ── 확인: 주문수량 = 6칸의 합 (0행이어야 한다) ──
-- SELECT o->>'id'
-- FROM jsonb_array_elements(db_order_flow()->'orders') o
-- WHERE (o->>'qty')::numeric <> (o->>'arrived_qty')::numeric + (o->>'waiting_qty')::numeric
--     + (o->>'undelivered_qty')::numeric + (o->>'cancel_done_qty')::numeric
--     + (o->>'cancel_pending_qty')::numeric + (o->>'closed_qty')::numeric;

-- ── 롤백 ──
-- DROP FUNCTION IF EXISTS public.db_order_flow();
