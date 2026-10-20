-- ============================================================
-- ft_cancel_details.barcode / site_url 추가 (취소·반품 당시 바코드·상품링크 보존)
--
-- 배경:
--   취소/반품 접수 시 바코드와 상품 링크가 저장되지 않아
--   ft_order_items 를 order_items_id 로 다시 따라가야만 볼 수 있었다.
--   원본 주문 값이 나중에 바뀌면 접수 당시 값이 남지 않는다.
--
-- 채우는 곳:
--   app/api/ft/cancel/route.ts 의 POST (ft_cancel_details INSERT 경로 한 곳뿐)
--     · barcode  ← ft_order_items.barcode
--     · site_url ← ft_order_items.site_url
--   값은 V2CancelModal 이 선택된 ft_order_items 행에서 그대로 넘긴다
--   (item_no·item_name 등 기존 스냅샷 필드와 같은 방식).
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 에 적용 완료 (2026-10-07).
-- 기존 4,382건은 아래 백필로 채움 (2026-10-07).
--   · 백필 값은 접수 당시가 아니라 백필 시점의 ft_order_items 값이다.
--   · ft_order_items.barcode 가 원래 NULL 인 2건은 barcode NULL 로 남는다.
-- ============================================================

ALTER TABLE public.ft_cancel_details
  ADD COLUMN IF NOT EXISTS barcode  text NULL,
  ADD COLUMN IF NOT EXISTS site_url text NULL;

COMMENT ON COLUMN public.ft_cancel_details.barcode IS
  '취소/반품 접수 당시 ft_order_items.barcode 스냅샷';
COMMENT ON COLUMN public.ft_cancel_details.site_url IS
  '취소/반품 접수 당시 ft_order_items.site_url (상품 링크) 스냅샷';

-- ============================================================
-- 기존 행 백필 (ft_order_items 에서 복사)
--
-- 트리거 영향 점검 (실행 전 확인함):
--   · trg_ft_cancel_details_settled_guard — barcode/site_url 은 감시 대상 아님 → 정산건도 통과
--   · trg_ft_cancel_details_amounts      — UPDATE 시 total_refund_cny 재계산.
--     기존 값과 재계산 값이 다른 행 0건 확인 → 금액 변동 없음
--     (total_refund_cny 합계 실행 전후 256,845.16 동일)
--   · 두 칸 모두 NULL 인 행만 대상 → 재실행해도 이미 채워진 값은 덮어쓰지 않는다
-- ============================================================
UPDATE public.ft_cancel_details cd
   SET barcode  = oi.barcode,
       site_url = oi.site_url
  FROM public.ft_order_items oi
 WHERE oi.id = cd.order_items_id
   AND cd.barcode  IS NULL
   AND cd.site_url IS NULL;

-- ── 확인 ──
-- SELECT count(*) AS total, count(barcode) AS with_barcode, count(site_url) AS with_site_url
-- FROM public.ft_cancel_details;

-- ── 롤백 ──
-- ALTER TABLE public.ft_cancel_details
--   DROP COLUMN IF EXISTS barcode,
--   DROP COLUMN IF EXISTS site_url;
