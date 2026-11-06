-- ============================================================
-- 1688 판매자 문의 — 메모 줄 기록 형식 · 확인수량 뜻
--   (a) ft_seller_inquiries.memo        : 한 줄 = 기록 1개, `MM.DD HH:mm <내용>` (KST, 연도 생략)
--   (b) ft_seller_inquiry_items.expected_qty : 구분별 뜻 (확인수량)
--   (c) 기존 메모 백필 — 도장이 없는 줄 앞에 그 접수의 received_at (KST) 도장을 붙인다
--       이미 도장이 있는 줄은 건드리지 않으므로 여러 번 실행해도 결과가 같다 (idempotent)
--   코드: lib/memoLog.ts (MEMO_STAMP_RE 와 같은 형식)
-- 적용: 사용자가 Supabase manage-item 에 직접 실행
-- ============================================================

-- ============================================================
-- (a) · (b) 열 설명
-- ============================================================
comment on column public.ft_seller_inquiries.memo is
  '메모 줄 기록: 한 줄 = 기록 1개, 형식 "MM.DD HH:mm 내용" (KST, 연도 생략). 추가는 맨 아래에 도장 1줄, 수정은 내용만(도장 유지), 삭제는 그 줄만. 도장 없는 줄 = 형식 이전 메모 (lib/memoLog.ts)';

comment on column public.ft_seller_inquiry_items.expected_qty is
  '확인수량: 미입고 = 입고되어야 할 수량(order−cancel), 확인요청 = 작업자 입력';

-- ============================================================
-- (c) 기존 메모 백필
--   · 빈 줄은 없애고, 각 줄 끝의 \r 은 지운다 (코드의 줄 분리와 같게)
--   · 도장 형식이 아닌 줄만 received_at(KST) 도장을 앞에 붙인다
--   · 바뀌는 행만 UPDATE (where 절 비교) — 두 번째 실행부터는 0행
-- ============================================================
with rebuilt as (
  select
    s.id,
    (
      select string_agg(
               case
                 when l.line ~ '^\d{2}\.\d{2} \d{2}:\d{2} ' then l.line
                 else to_char(s.received_at at time zone 'Asia/Seoul', 'MM.DD HH24:MI ') || l.line
               end,
               E'\n' order by l.n
             )
      from (
        select regexp_replace(t.line, E'\r$', '') as line, t.n
        from regexp_split_to_table(s.memo, E'\n') with ordinality as t(line, n)
      ) l
      where btrim(l.line) <> ''
    ) as new_memo
  from public.ft_seller_inquiries s
  where s.memo is not null
)
update public.ft_seller_inquiries s
set memo = r.new_memo
from rebuilt r
where s.id = r.id
  and s.memo is distinct from r.new_memo;
