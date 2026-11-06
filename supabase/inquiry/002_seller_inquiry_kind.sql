-- ============================================================
-- 1688 판매자 문의 — 구분(kind) 추가
--   · '미입고'   : 상품입고 [미입고] 버튼 — 부족 수량 접수 (기존 데이터는 모두 이 값)
--   · '확인요청' : 상품입고 [1688 판매자 확인] 버튼 — 선택한 글번호에 대한 확인 요청
-- 적용: 2026-11-06 (Supabase manage-item)
-- ============================================================

alter table public.ft_seller_inquiries
  add column if not exists kind text not null default '미입고';

alter table public.ft_seller_inquiries
  drop constraint if exists ft_seller_inquiries_kind_check;

alter table public.ft_seller_inquiries
  add constraint ft_seller_inquiries_kind_check
  check (kind in ('미입고', '확인요청'));

-- 목록 조회: 구분 탭 + 상태 탭 조합
create index if not exists ft_seller_inquiries_kind_status_received_idx
  on public.ft_seller_inquiries (kind, status, received_at desc);

comment on column public.ft_seller_inquiries.kind is '구분: 미입고 | 확인요청';
