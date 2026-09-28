-- ============================================================
-- 처리속도 통계 — db_process_speed(p_period, p_basis)
--
-- 화면: /db/volume [처리속도] 탭 ← GET /api/db/process-speed
--
-- 단계 (단위: 일, 버킷 = 단계가 "끝난" 시각의 KST 주(월요일 시작)/월)
--   delivery  배송   1688 주문일시 → 배송완료(추정)            항목(ft_order_items) 단위
--   arrival   입고   배송완료(추정) → 첫 ARRIVAL                항목 단위
--   packing   포장   포장 직전 마지막 ARRIVAL → PACKED          PACKED 행 단위
--                    세트(set_total > 1)는 같은 product_id 형제 항목의 ARRIVAL 까지 포함
--                    (세트는 부품이 다 와야 포장 — confirmDone 의 product_id 기준과 동일)
--   outbound  출고   PACKED → 출고                              PACKED 행 단위
--                    basis='shipment'  : ft_shipments.created_at (출고 버튼 시각)
--                    basis='confirmed' : ft_shipment_details.confirmed_at
--
-- 배송완료 시각 = im_1688_delivered_estimate(하한, 상한) — im_1688_delivery_history
--   upper_only(하한 없음)은 n_upper_only 로 따로 센다 (화면에 "추정" 표기)
--
-- 행 상태
--   ok       정상 집계
--   skip     시각 역전 = 데이터 오류 (n_skipped)
--            · 배송: 배송완료 < 주문일시
--            · 입고: 첫 ARRIVAL < 배송완료 하한 (배송완료 전에 입고된 셈)
--            · 포장/출고: 음수 소요
--   exclude  계산 불가 — 세지 않음
--            · 입고 upper_only 인데 ARRIVAL < 상한 : 실제 배송완료 시각을 알 수 없음
--            · 출고 basis=confirmed 인데 확정 전
--   입고가 하한~추정시각 사이면 0일 (배송완료 직후 입고)
--
-- A/B/C/P/X 는 SQL 에서 판정하지 않는다 — raw (shipment_type, coupang_shipment_size) 로
-- 묶어 반환하고 API 가 lib/sizeCode.resolveScanSizeCode 로 접는다 (판정 로직 단일화).
--
-- 반환: jsonb 배열 1개 (행 = 기간 × raw 사이즈 × 세트여부 × 단계).
--   PostgREST 최대 응답 1000행 제한을 피하고, 집계를 한 번만 실행하기 위해 jsonb 로 묶는다.
--
-- 권한: service role 전용 / 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-09-28)
-- ============================================================

CREATE OR REPLACE FUNCTION public.db_process_speed(
  p_period text DEFAULT 'week',
  p_basis  text DEFAULT 'shipment'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH
params AS (
  SELECT CASE WHEN p_period = 'month' THEN 'month' ELSE 'week' END      AS unit,
         CASE WHEN p_basis = 'confirmed' THEN 'confirmed' ELSE 'shipment' END AS basis
),

-- ── 항목 속성 ──
items AS (
  SELECT i.id,
         i.product_id,
         NULLIF(btrim(i."1688_order_id"), '') AS order_no,
         i.shipment_type,
         i.coupang_shipment_size,
         COALESCE(i.set_total, 1) > 1 AS is_set
  FROM ft_order_items i
),

arrivals AS (
  SELECT f.order_item_id, f.created_at
  FROM ft_fulfillment_inbounds f
  WHERE f.type = 'ARRIVAL' AND f.order_item_id IS NOT NULL
),

first_arrival AS (
  SELECT order_item_id, min(created_at) AS at
  FROM arrivals
  GROUP BY order_item_id
),

hist AS (
  SELECT h.order_no,
         h.ordered_at,
         h.delivered_after_at,
         h.delivered_seen_at,
         im_1688_delivered_estimate(h.delivered_after_at, h.delivered_seen_at) AS delivered_at
  FROM im_1688_delivery_history h
  WHERE h.delivered_seen_at IS NOT NULL
),

packed AS (
  SELECT o.id, o.order_item_id, o.created_at, o.shipment_id
  FROM ft_fulfillment_outbounds o
  WHERE o.type = 'PACKED' AND o.order_item_id IS NOT NULL
),

-- ============================================================
-- 배송: 주문일시 → 배송완료(추정)
-- ============================================================
s_delivery AS (
  SELECT 'delivery'::text AS stage,
         it.shipment_type, it.coupang_shipment_size, it.is_set,
         h.delivered_at AS done_at,
         EXTRACT(EPOCH FROM (h.delivered_at - h.ordered_at)) / 86400.0 AS days,
         h.delivered_after_at IS NULL AS upper_only,
         CASE WHEN h.delivered_at < h.ordered_at THEN 'skip' ELSE 'ok' END AS state
  FROM items it
  JOIN hist h ON h.order_no = it.order_no
  WHERE h.ordered_at IS NOT NULL
),

-- ============================================================
-- 입고: 배송완료(추정) → 첫 ARRIVAL
-- ============================================================
s_arrival AS (
  SELECT 'arrival'::text AS stage,
         it.shipment_type, it.coupang_shipment_size, it.is_set,
         fa.at AS done_at,
         GREATEST(EXTRACT(EPOCH FROM (fa.at - h.delivered_at)) / 86400.0, 0) AS days,
         h.delivered_after_at IS NULL AS upper_only,
         CASE
           WHEN h.delivered_after_at IS NULL AND fa.at < h.delivered_seen_at THEN 'exclude'
           WHEN h.delivered_after_at IS NOT NULL AND fa.at < h.delivered_after_at THEN 'skip'
           ELSE 'ok'
         END AS state
  FROM items it
  JOIN hist h           ON h.order_no = it.order_no
  JOIN first_arrival fa ON fa.order_item_id = it.id
),

-- ============================================================
-- 포장: 포장 직전 마지막 ARRIVAL → PACKED
--   단품: 자기 항목 / 세트: 같은 product_id 의 모든 항목
--   (두 경우를 UNION 으로 나눠 등호 조인만 쓰게 한다 — 인덱스 없는 테이블에서 해시 조인)
-- ============================================================
pack_members AS (
  SELECT p.id AS packed_id, p.created_at AS packed_at, rep.id AS member_id
  FROM packed p
  JOIN items rep ON rep.id = p.order_item_id
  WHERE NOT (rep.is_set AND rep.product_id IS NOT NULL)
  UNION ALL
  SELECT p.id, p.created_at, sib.id
  FROM packed p
  JOIN items rep ON rep.id = p.order_item_id
  JOIN items sib ON sib.product_id = rep.product_id
  WHERE rep.is_set AND rep.product_id IS NOT NULL
),

pack_start AS (
  SELECT m.packed_id, max(a.created_at) AS start_at
  FROM pack_members m
  JOIN arrivals a ON a.order_item_id = m.member_id AND a.created_at <= m.packed_at
  GROUP BY m.packed_id
),

s_packing AS (
  SELECT 'packing'::text AS stage,
         rep.shipment_type, rep.coupang_shipment_size, rep.is_set,
         p.created_at AS done_at,
         EXTRACT(EPOCH FROM (p.created_at - ps.start_at)) / 86400.0 AS days,
         false AS upper_only,
         CASE WHEN p.created_at < ps.start_at THEN 'skip' ELSE 'ok' END AS state
  FROM packed p
  JOIN items rep      ON rep.id = p.order_item_id
  JOIN pack_start ps  ON ps.packed_id = p.id
),

-- ============================================================
-- 출고: PACKED → 출고 (basis 선택)
-- ============================================================
confirmed AS (
  SELECT d.fulfillment_id, min(d.confirmed_at) AS confirmed_at
  FROM ft_shipment_details d
  WHERE d.fulfillment_id IS NOT NULL AND d.confirmed_at IS NOT NULL
  GROUP BY d.fulfillment_id
),

s_outbound_raw AS (
  SELECT rep.shipment_type, rep.coupang_shipment_size, rep.is_set,
         p.created_at AS packed_at,
         CASE WHEN pr.basis = 'confirmed' THEN c.confirmed_at ELSE s.created_at END AS end_at
  FROM packed p
  CROSS JOIN params pr
  JOIN items rep          ON rep.id = p.order_item_id
  JOIN ft_shipments s     ON s.id = p.shipment_id
  LEFT JOIN confirmed c   ON c.fulfillment_id = p.id::text
),

s_outbound AS (
  SELECT 'outbound'::text AS stage,
         shipment_type, coupang_shipment_size, is_set,
         end_at AS done_at,
         EXTRACT(EPOCH FROM (end_at - packed_at)) / 86400.0 AS days,
         false AS upper_only,
         CASE
           WHEN end_at IS NULL     THEN 'exclude'
           WHEN end_at < packed_at THEN 'skip'
           ELSE 'ok'
         END AS state
  FROM s_outbound_raw
),

all_stages AS (
  SELECT * FROM s_delivery
  UNION ALL SELECT * FROM s_arrival
  UNION ALL SELECT * FROM s_packing
  UNION ALL SELECT * FROM s_outbound
),

agg AS (
  SELECT date_trunc(pr.unit, a.done_at AT TIME ZONE 'Asia/Seoul')::date AS period_start,
         a.shipment_type,
         a.coupang_shipment_size,
         a.is_set,
         a.stage,
         COALESCE(sum(a.days) FILTER (WHERE a.state = 'ok'), 0)      AS sum_days,
         count(*) FILTER (WHERE a.state = 'ok')                      AS n,
         count(*) FILTER (WHERE a.state = 'ok' AND a.upper_only)     AS n_upper_only,
         count(*) FILTER (WHERE a.state = 'skip')                    AS n_skipped
  FROM all_stages a
  CROSS JOIN params pr
  WHERE a.state <> 'exclude' AND a.done_at IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
)

SELECT COALESCE(jsonb_agg(jsonb_build_object(
         'period_start',          period_start,
         'shipment_type',         shipment_type,
         'coupang_shipment_size', coupang_shipment_size,
         'is_set',                is_set,
         'stage',                 stage,
         'sum_days',              round(sum_days::numeric, 4),
         'n',                     n,
         'n_upper_only',          n_upper_only,
         'n_skipped',             n_skipped
       ) ORDER BY period_start, stage), '[]'::jsonb)
FROM agg
$$;

REVOKE ALL ON FUNCTION public.db_process_speed(text, text)
  FROM PUBLIC, anon, authenticated;
