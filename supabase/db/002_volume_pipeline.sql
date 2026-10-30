-- ============================================================
-- 물량예측 — db_volume_pipeline()
--
-- 화면: /db/volume [물량예측] 탭 ← GET /api/db/volume-forecast
--
-- PROCESSING 주문 항목(ft_order_items)의 수량을 파이프라인 다섯 칸으로 나누고,
-- 유입 예측·필요 인원 계산에 필요한 원자료를 jsonb 1개로 돌려준다.
-- (주문항목 4만 · 입고 4.3만 · 포장 2.9만 · 쉽먼트상세 2.8만 행 — 행을 내려받지 않는다)
--
-- 칸 (항목 단위, 한 항목이 여러 칸에 걸칠 수 있다)
--   unshipped         미발송              남은수량 = 주문 − 입고 − 취소반품   배송이력에 발송 확인 없음
--   in_transit        배송중              〃                                   발송 확인 있고 배송완료 없음
--   delivered_waiting 배송완료·입고 대기  〃                                   배송완료 확인 있음
--   no_history        배송이력 없음       〃                                   im_1688_delivery_history 에 주문 없음
--   arrived_waiting   입고 완료·포장 대기  입고 − 포장
--   packed_waiting    포장 완료·출고 대기  포장 − 출고(ft_shipment_details)
--
--   입고량은 ft_fulfillment_inbounds(ARRIVAL) 에서 센다 — ft_order_items.arrival_qty 는 운영에서 0.
--   취소반품(CANCEL/RETURN 입고 행)은 미입고 칸에서만 차감한다.
--
-- 반환 jsonb
--   snapshot.stages.<칸>   {items, qty}
--   snapshot.wait_hist     포장 대기 항목의 대기 일수(마지막 입고 스캔 기준) [{days, items, qty}]
--   snapshot.inconsistent  포장 > 입고 인 항목 수 (입고 스캔 없이 포장)
--   pending                미입고 항목을 (칸, 기준일로부터 지난 일수)로 묶음 [{stage, days, items, qty}]
--                          기준일: unshipped=주문일시, in_transit=발송 추정, delivered_waiting=배송완료 추정,
--                                  no_history=주문 항목 생성일
--   lead_hist              최근 56일 입고 기준 소요일 분포 {ordered|shipped|delivered: [{days, n}]}
--                          ordered=주문→첫입고, shipped=발송추정→첫입고, delivered=배송완료추정→첫입고
--   capacity_days          최근 28일 일별 {date, arr_rows, arr_qty, pack_rows, pack_qty,
--                                        minutes_all, minutes_pi, ppl_all, ppl_pi}  (pi = 포장+검수)
--   check_needed           배송완료 추정 7일 지났는데 입고 스캔이 한 건도 없는 항목 (최대 300)
--   meta.last_upload_at    배송상황 CSV 마지막 업로드
--
-- 발송·배송완료 추정 시각은 im_1688_delivered_estimate(하한, 상한) — 처리속도 통계와 동일.
--
-- 권한: service role 전용 / 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-10-30)
-- ============================================================

CREATE OR REPLACE FUNCTION public.db_volume_pipeline()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH
now_kst AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today),

-- ── 항목 + 입고/포장/출고 합 ──
items AS (
  SELECT i.id, i.user_id, i.created_at, i.order_no, i.item_no, i.item_name, i.option_name,
         COALESCE(i.order_qty, 0) AS order_qty,
         NULLIF(btrim(i."1688_order_id"), '') AS ono
  FROM ft_order_items i
  WHERE i.status = 'PROCESSING'
),
inb AS (
  SELECT f.order_item_id,
         COALESCE(sum(f.quantity) FILTER (WHERE f.type = 'ARRIVAL'), 0)                    AS arr,
         COALESCE(sum(f.quantity) FILTER (WHERE f.type IN ('CANCEL', 'RETURN')), 0)        AS cr,
         max(f.created_at) FILTER (WHERE f.type = 'ARRIVAL')                                AS last_arr
  FROM ft_fulfillment_inbounds f
  WHERE f.order_item_id IN (SELECT id FROM items)
  GROUP BY f.order_item_id
),
pk AS (
  SELECT o.order_item_id, COALESCE(sum(o.quantity), 0) AS q
  FROM ft_fulfillment_outbounds o
  WHERE o.type = 'PACKED' AND o.order_item_id IN (SELECT id FROM items)
  GROUP BY o.order_item_id
),
sd AS (
  SELECT d.order_item_id::uuid AS order_item_id, COALESCE(sum(d.quantity), 0) AS q
  FROM ft_shipment_details d
  WHERE d.order_item_id IS NOT NULL AND d.order_item_id::uuid IN (SELECT id FROM items)
  GROUP BY d.order_item_id
),
hist AS (
  SELECT h.order_no, h.ordered_at,
         im_1688_delivered_estimate(h.shipped_after_at,   h.shipped_seen_at)   AS shipped_at,
         im_1688_delivered_estimate(h.delivered_after_at, h.delivered_seen_at) AS delivered_at
  FROM im_1688_delivery_history h
),
j AS (
  SELECT it.*,
         COALESCE(inb.arr, 0) AS arr, COALESCE(inb.cr, 0) AS cr, inb.last_arr,
         COALESCE(pk.q, 0) AS pkq, COALESCE(sd.q, 0) AS sdq,
         GREATEST(it.order_qty - COALESCE(inb.arr, 0) - COALESCE(inb.cr, 0), 0) AS left_qty,
         GREATEST(COALESCE(inb.arr, 0) - COALESCE(pk.q, 0), 0)                    AS wait_qty,
         GREATEST(COALESCE(pk.q, 0) - COALESCE(sd.q, 0), 0)                       AS packed_qty,
         h.order_no IS NOT NULL AS has_hist,
         h.ordered_at, h.shipped_at, h.delivered_at,
         CASE
           WHEN h.order_no IS NULL          THEN 'no_history'
           WHEN h.delivered_at IS NOT NULL  THEN 'delivered_waiting'
           WHEN h.shipped_at IS NOT NULL    THEN 'in_transit'
           ELSE 'unshipped'
         END AS stage,
         CASE
           WHEN h.order_no IS NULL          THEN it.created_at
           WHEN h.delivered_at IS NOT NULL  THEN h.delivered_at
           WHEN h.shipped_at IS NOT NULL    THEN h.shipped_at
           ELSE COALESCE(h.ordered_at, it.created_at)
         END AS base_at
  FROM items it
  LEFT JOIN inb  ON inb.order_item_id = it.id
  LEFT JOIN pk   ON pk.order_item_id  = it.id
  LEFT JOIN sd   ON sd.order_item_id  = it.id
  LEFT JOIN hist h ON h.order_no = it.ono
),

-- ── 스냅샷 ──
stage_agg AS (
  SELECT stage, count(*) AS items, sum(left_qty) AS qty
  FROM j WHERE left_qty > 0 GROUP BY stage
),
stages AS (
  SELECT jsonb_build_object(
    'unshipped',         (SELECT jsonb_build_object('items', COALESCE(items, 0), 'qty', COALESCE(qty, 0)) FROM stage_agg WHERE stage = 'unshipped'),
    'in_transit',        (SELECT jsonb_build_object('items', COALESCE(items, 0), 'qty', COALESCE(qty, 0)) FROM stage_agg WHERE stage = 'in_transit'),
    'delivered_waiting', (SELECT jsonb_build_object('items', COALESCE(items, 0), 'qty', COALESCE(qty, 0)) FROM stage_agg WHERE stage = 'delivered_waiting'),
    'no_history',        (SELECT jsonb_build_object('items', COALESCE(items, 0), 'qty', COALESCE(qty, 0)) FROM stage_agg WHERE stage = 'no_history'),
    'arrived_waiting',   (SELECT jsonb_build_object('items', count(*), 'qty', COALESCE(sum(wait_qty), 0))   FROM j WHERE wait_qty > 0),
    'packed_waiting',    (SELECT jsonb_build_object('items', count(*), 'qty', COALESCE(sum(packed_qty), 0)) FROM j WHERE packed_qty > 0)
  ) AS v
),
wait_hist AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('days', days, 'items', items, 'qty', qty) ORDER BY days), '[]'::jsonb) AS v
  FROM (
    SELECT LEAST(floor(EXTRACT(EPOCH FROM (now() - last_arr)) / 86400)::int, 60) AS days,
           count(*) AS items, sum(wait_qty) AS qty
    FROM j WHERE wait_qty > 0 AND last_arr IS NOT NULL
    GROUP BY 1
  ) x
),

-- ── 미입고 항목 (칸 × 지난 일수) ──
pending AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('stage', stage, 'days', days, 'items', items, 'qty', qty) ORDER BY stage, days), '[]'::jsonb) AS v
  FROM (
    SELECT stage,
           LEAST(GREATEST(floor(EXTRACT(EPOCH FROM (now() - base_at)) / 86400)::int, 0), 90) AS days,
           count(*) AS items, sum(left_qty) AS qty
    FROM j WHERE left_qty > 0
    GROUP BY 1, 2
  ) x
),

-- ── 소요일 분포 (최근 56일 첫 입고 기준, 0~60일) ──
first_arrival AS (
  SELECT f.order_item_id, min(f.created_at) AS at
  FROM ft_fulfillment_inbounds f
  WHERE f.type = 'ARRIVAL' AND f.created_at >= now() - interval '56 days'
  GROUP BY f.order_item_id
),
lead_rows AS (
  SELECT fa.at,
         h.ordered_at, h.shipped_at, h.delivered_at
  FROM first_arrival fa
  JOIN ft_order_items i ON i.id = fa.order_item_id
  JOIN hist h ON h.order_no = NULLIF(btrim(i."1688_order_id"), '')
),
lead_hist AS (
  SELECT jsonb_build_object(
    'ordered',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('days', d, 'n', n) ORDER BY d), '[]'::jsonb) FROM (
                    SELECT LEAST(floor(EXTRACT(EPOCH FROM (at - ordered_at)) / 86400)::int, 60) AS d, count(*) AS n
                    FROM lead_rows WHERE ordered_at IS NOT NULL AND at >= ordered_at GROUP BY 1) x),
    'shipped',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('days', d, 'n', n) ORDER BY d), '[]'::jsonb) FROM (
                    SELECT LEAST(floor(EXTRACT(EPOCH FROM (at - shipped_at)) / 86400)::int, 60) AS d, count(*) AS n
                    FROM lead_rows WHERE shipped_at IS NOT NULL AND at >= shipped_at GROUP BY 1) x),
    'delivered', (SELECT COALESCE(jsonb_agg(jsonb_build_object('days', d, 'n', n) ORDER BY d), '[]'::jsonb) FROM (
                    SELECT LEAST(floor(EXTRACT(EPOCH FROM (at - delivered_at)) / 86400)::int, 60) AS d, count(*) AS n
                    FROM lead_rows WHERE delivered_at IS NOT NULL AND at >= delivered_at GROUP BY 1) x)
  ) AS v
),

-- ── 최근 28일 일별 처리 능력 ──
days AS (
  SELECT generate_series((SELECT today FROM now_kst) - 28, (SELECT today FROM now_kst) - 1, interval '1 day')::date AS d
),
arr_day AS (
  SELECT (f.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, count(*) AS rows_, COALESCE(sum(f.quantity), 0) AS qty
  FROM ft_fulfillment_inbounds f
  WHERE f.type = 'ARRIVAL' AND f.created_at >= now() - interval '30 days'
  GROUP BY 1
),
pack_day AS (
  SELECT (o.created_at AT TIME ZONE 'Asia/Seoul')::date AS d, count(*) AS rows_, COALESCE(sum(o.quantity), 0) AS qty
  FROM ft_fulfillment_outbounds o
  WHERE o.type = 'PACKED' AND o.created_at >= now() - interval '30 days'
  GROUP BY 1
),
work_day AS (
  SELECT r.work_date::date AS d,
         COALESCE(sum(r.total_minutes), 0)                                                           AS minutes_all,
         COALESCE(sum(r.total_minutes) FILTER (WHERE e.role IN ('포장', '검수')), 0)                AS minutes_pi,
         count(DISTINCT r.employee_id)                                                                AS ppl_all,
         count(DISTINCT r.employee_id) FILTER (WHERE e.role IN ('포장', '검수'))                     AS ppl_pi
  FROM "invoiceManager_emplyee_records" r
  LEFT JOIN "invoiceManager_employees" e ON e.id = r.employee_id
  WHERE r.work_date::date >= (SELECT today FROM now_kst) - 28
  GROUP BY 1
),
capacity_days AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', to_char(days.d, 'YYYY-MM-DD'),
           'arr_rows',  COALESCE(a.rows_, 0), 'arr_qty',  COALESCE(a.qty, 0),
           'pack_rows', COALESCE(p.rows_, 0), 'pack_qty', COALESCE(p.qty, 0),
           'minutes_all', COALESCE(w.minutes_all, 0), 'minutes_pi', COALESCE(w.minutes_pi, 0),
           'ppl_all', COALESCE(w.ppl_all, 0), 'ppl_pi', COALESCE(w.ppl_pi, 0)
         ) ORDER BY days.d), '[]'::jsonb) AS v
  FROM days
  LEFT JOIN arr_day  a ON a.d = days.d
  LEFT JOIN pack_day p ON p.d = days.d
  LEFT JOIN work_day w ON w.d = days.d
),

-- ── 확인 필요: 배송완료 추정 7일 지났는데 입고 스캔 없음 ──
check_needed AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_no', x.order_no, 'item_no', x.item_no, 'item_name', x.item_name, 'option_name', x.option_name,
           'left_qty', x.left_qty, 'delivered_at', x.delivered_at, 'vender_name', u.vender_name,
           'ono', x.ono
         ) ORDER BY x.delivered_at), '[]'::jsonb) AS v
  FROM (
    SELECT * FROM j
    WHERE stage = 'delivered_waiting' AND left_qty > 0 AND arr = 0
      AND delivered_at < now() - interval '7 days'
    ORDER BY delivered_at
    LIMIT 300
  ) x
  LEFT JOIN ft_users u ON u.id = x.user_id
)

SELECT jsonb_build_object(
  'snapshot', jsonb_build_object(
    'stages',       (SELECT v FROM stages),
    'wait_hist',    (SELECT v FROM wait_hist),
    'inconsistent', (SELECT count(*) FROM j WHERE pkq > arr)
  ),
  'pending',       (SELECT v FROM pending),
  'lead_hist',     (SELECT v FROM lead_hist),
  'capacity_days', (SELECT v FROM capacity_days),
  'check_needed',  (SELECT v FROM check_needed),
  'meta', jsonb_build_object(
    'last_upload_at', (SELECT max(last_seen_at) FROM im_1688_delivery_history),
    'today', (SELECT to_char(today, 'YYYY-MM-DD') FROM now_kst)
  )
)
$$;

REVOKE ALL ON FUNCTION public.db_volume_pipeline()
  FROM PUBLIC, anon, authenticated;
