-- ============================================================
-- 고객 포털(purchase-agent, anon 키) 재고관리(/inventory) 읽기
--
--   테이블·뷰(ft_storage_locations / ft_storage_movements / ft_storage_balance)는
--   001 에서 이미 anon SELECT 를 열었다. [작업중](미배치) 줄은 DB 함수가 유일한 계산처라
--   그 함수의 EXECUTE 만 추가로 연다. STABLE · 읽기 전용 · user_id 인자로 팀 격리
--   (다른 ft_* 표와 같이 앱 쿼리의 user_id 조건에 의존).
--   쓰기 함수(putaway / pick / move / unpick)는 그대로 service role 전용.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 (2026-11-02)
-- ============================================================

GRANT EXECUTE ON FUNCTION public.ft_storage_pending_lines(uuid, uuid) TO anon, authenticated;
