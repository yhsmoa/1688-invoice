-- ============================================================
-- 1688 배송 이력 — 부트스트랩 (1회)
--
-- 현재 스냅샷(im_1688_orders_delivery_status)을 이력에 시딩한다.
--   · ordered_at        = timestamp (주문일시)
--   · last_seen_at      = created_at (마지막 업로드 때 삽입된 시각)
--   · last_status       = delivery_status
--   · 배송완료 단계     → delivered_seen_at = status_since, 하한 NULL (upper_only)
--       status_since 는 기능 도입(2026-09-22) 이후의 "이 단계가 된 업로드 시각" 이라
--       상한으로는 유효하지만, 그 전에 이 주문이 목록에 있었는지 알 수 없어 하한은 비운다.
--   · 집하대기/운송중   → shipped_seen_at = status_since, 하한 NULL
--
-- 단계 분류는 lib/deliveryPhase.ts 의 PHASE_OF 와 동일 목록을 쓴다.
-- ON CONFLICT DO NOTHING → 재실행 안전 (이미 쌓인 이력은 건드리지 않음).
--
-- 실행 결과 (2026-09-28, 운영 DB): 스냅샷 1,313행 → 이력 1,313행
--   배송완료 1,206 / 발송 관찰 79 (운송중 61 + 서명대기 12 + 집하대기 6) / 주문일시 1,313
-- ============================================================

-- ── 사전 검증: 스냅샷 주문번호 중복 0 이어야 함 ──
-- SELECT count(*) - count(DISTINCT "1688_order_no") AS dup FROM im_1688_orders_delivery_status;

INSERT INTO public.im_1688_delivery_history AS h (
  order_no, ordered_at,
  shipped_seen_at, delivered_seen_at, delivered_status,
  last_status, last_seen_at, courier, tracking_no
)
SELECT DISTINCT ON (btrim(s."1688_order_no"))
  btrim(s."1688_order_no"),
  s."timestamp",
  CASE WHEN s.delivery_status IN ('待揽收', '已发货', '已揽收', '已揽件', '运输中', '派送中', '待收货')
       THEN s.status_since END,
  CASE WHEN s.delivery_status IN ('已签收', '已收货未到账')
       THEN s.status_since END,
  CASE WHEN s.delivery_status IN ('已签收', '已收货未到账')
       THEN s.delivery_status END,
  s.delivery_status,
  COALESCE(s.created_at, now()),
  NULLIF(btrim(s.courier), ''),
  NULLIF(btrim(s.tracking_no), '')
FROM public.im_1688_orders_delivery_status s
WHERE s."1688_order_no" IS NOT NULL AND btrim(s."1688_order_no") <> ''
ORDER BY btrim(s."1688_order_no"), s."timestamp" DESC NULLS LAST
ON CONFLICT (order_no) DO NOTHING;

-- ── 사후 검증 ──
-- SELECT count(*) total,
--        count(delivered_seen_at) delivered,
--        count(shipped_seen_at)   shipped
-- FROM im_1688_delivery_history;
