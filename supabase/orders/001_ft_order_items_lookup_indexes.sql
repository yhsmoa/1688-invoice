-- ============================================================
-- ft_order_items 조회 인덱스 — 탑메뉴 [BARCODE] 모달 (/api/ft/order-items/lookup)
--
--   스캔 값으로 product_no / item_no / barcode 를 정확 일치로 찾는다.
--   기존 인덱스는 전부 user_id 가 앞에 있어 사용자 없이 찾는 이 조회에는 쓰이지 않는다.
--   2026-10-25 기준 39,473행 — 지금은 순차 스캔도 수십 ms 지만 행이 계속 늘어나므로 추가.
--
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ft_order_items_product_no ON public.ft_order_items (product_no);
CREATE INDEX IF NOT EXISTS idx_ft_order_items_item_no    ON public.ft_order_items (item_no);
CREATE INDEX IF NOT EXISTS idx_ft_order_items_barcode    ON public.ft_order_items (barcode);
