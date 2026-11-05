-- ============================================================
-- 고객 검수 확인요청 — 타입 코드(size_code) 를 주문 행과 동기화
--
-- 문제: ft_customer_checks.size_code 는 [고객확인] 요청 시점의 스냅샷이라, 그 뒤
--       주문진행에서 타입(A/B/C/P/X, 보관 S)을 바꿔도 검수 화면(창고 · 고객 포털)은
--       옛 타입을 보여 줘 혼동이 생겼다.
-- 해결: ft_order_items 의 shipment_type / coupang_shipment_size / arrival_route 가
--       바뀌면 트리거가 그 주문 행을 참조하는 검수 건의 size_code 를 같은 규칙으로 갱신한다.
--       (어느 앱·어느 경로로 바꾸든 DB 에서 한 번에 맞춘다)
--
-- 규칙은 lib/sizeCode.ts resolveTypeBadge 와 동일:
--   arrival_route = STOCK → S
--   DIRECT → X · PERSONAL → P
--   COUPANG → small/medium/large = A/B/C, 그 외 값은 그대로, 없으면 NULL
--   shipment_type 없음(레거시) → coupang_shipment_size 로 판정 (small/medium/large/p-*/direct)
-- ============================================================

create or replace function public.ft_type_code(
  p_shipment_type text,
  p_size text,
  p_arrival_route text
) returns text
language sql
immutable
as $$
  select case
    when p_arrival_route = 'STOCK' then 'S'
    when upper(trim(coalesce(p_shipment_type, ''))) = 'DIRECT' then 'X'
    when upper(trim(coalesce(p_shipment_type, ''))) = 'PERSONAL' then 'P'
    when upper(trim(coalesce(p_shipment_type, ''))) = 'COUPANG' then
      case lower(trim(coalesce(p_size, '')))
        when 'small' then 'A'
        when 'medium' then 'B'
        when 'large' then 'C'
        when '' then null
        else trim(p_size)
      end
    when coalesce(trim(p_size), '') <> '' then
      case
        when lower(trim(p_size)) = 'small' then 'A'
        when lower(trim(p_size)) = 'medium' then 'B'
        when lower(trim(p_size)) = 'large' then 'C'
        when lower(trim(p_size)) like 'p-%' then 'P'
        when lower(trim(p_size)) = 'direct' then 'X'
        else trim(p_size)
      end
    else null
  end
$$;

create or replace function public.ft_customer_checks_sync_size_code()
returns trigger
language plpgsql
as $$
begin
  if new.shipment_type is distinct from old.shipment_type
     or new.coupang_shipment_size is distinct from old.coupang_shipment_size
     or new.arrival_route is distinct from old.arrival_route then
    update public.ft_customer_checks
       set size_code = public.ft_type_code(new.shipment_type, new.coupang_shipment_size, new.arrival_route),
           updated_at = now()
     where order_item_id = new.id;
  end if;
  return null;
end
$$;

drop trigger if exists trg_ft_customer_checks_sync_size_code on public.ft_order_items;
create trigger trg_ft_customer_checks_sync_size_code
  after update of shipment_type, coupang_shipment_size, arrival_route
  on public.ft_order_items
  for each row
  execute function public.ft_customer_checks_sync_size_code();

-- 이미 어긋난 건 보정 (한 번)
update public.ft_customer_checks c
   set size_code = public.ft_type_code(oi.shipment_type, oi.coupang_shipment_size, oi.arrival_route),
       updated_at = now()
  from public.ft_order_items oi
 where oi.id = c.order_item_id
   and c.size_code is distinct from public.ft_type_code(oi.shipment_type, oi.coupang_shipment_size, oi.arrival_route);
