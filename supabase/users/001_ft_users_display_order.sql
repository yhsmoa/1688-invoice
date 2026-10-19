-- ============================================================
-- ft_users.display_order — 사업자 드롭박스 표시 순서
--
-- /api/ft/users 가 이 순서로 정렬해 내려준다 (주문상태·상품입고·쉽먼트 등 전 페이지 공통).
--   1) display_order 오름차순
--   2) display_order 가 비어 있는 사업자(새로 추가된 사업자)는 그 뒤에 가입 순(created_at)
-- 순서를 바꿀 때는 배포 없이 이 칸의 값만 바꾸면 된다.
--
-- ft_users 는 다른 프로젝트의 회원가입도 쓰는 테이블이라, 비어 있어도 되는(nullable)
-- 칸으로만 추가한다 — 기존 INSERT 에는 영향이 없다.
-- 적용: 2026-10-19 (운영 DB mkcxpkblohioqboemmah)
-- ============================================================

alter table public.ft_users
  add column if not exists display_order integer;

comment on column public.ft_users.display_order is
  '사업자 드롭박스 표시 순서 (오름차순). 비어 있으면 순서가 정해진 사업자 뒤에 가입 순으로 표시';

-- ── 초기 순서: BZ → BO → BR → HI → MB ──
update public.ft_users as u
set display_order = v.ord
from (values ('BZ', 1), ('BO', 2), ('BR', 3), ('HI', 4), ('MB', 5)) as v(code, ord)
where u.user_code = v.code;
