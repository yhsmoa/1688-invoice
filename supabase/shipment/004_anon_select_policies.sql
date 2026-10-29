-- ============================================================
-- 고객 포털(purchase-agent, anon 키) 읽기 정책
--
--   ft_box_info              : RLS 켜짐 + 정책 0개 → anon 이 박스 사이즈를 읽지 못했음
--   ft_shipment_manual_items : 003 에서 RLS 켬 → 출고준비 화면에서 부자재 행 표시용
--
--   SELECT 만 연다. 쓰기는 기존대로 막힌다 (정책 없음 + 1688-invoice 는 service role).
--   팀 격리는 다른 ft_* 표와 같이 앱 쿼리의 user_id 조건으로 한다.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-10-29)
-- ============================================================

DROP POLICY IF EXISTS ft_box_info_anon_select ON public.ft_box_info;
CREATE POLICY ft_box_info_anon_select
  ON public.ft_box_info
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS ft_shipment_manual_items_anon_select ON public.ft_shipment_manual_items;
CREATE POLICY ft_shipment_manual_items_anon_select
  ON public.ft_shipment_manual_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.ft_shipment_manual_items TO anon, authenticated;
