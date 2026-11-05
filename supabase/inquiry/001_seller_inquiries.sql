-- ============================================================
-- 1688 판매자 문의 — 미입고(부족) 접수
--
-- 목적:
--   상품입고 V2/V3 에서 배송번호로 검색해 입고 수량을 넣었는데 덜 들어온 주문행이 있으면
--   [미입고] 버튼으로 "이 배송번호에서 무엇이 몇 개 부족한가" 를 접수하고, 창고 PC(/seller-inquiry)와
--   모바일(/m/seller-inquiry, 운송장 바코드 촬영 → 사진 첨부)이 같은 데이터로 판매자 문의를 진행한다.
--
-- 구조:
--   1) ft_seller_inquiries        — 접수 1건 = 배송번호 1개 (사용자별). 상태·메모·시각
--   2) ft_seller_inquiry_items    — 부족 주문행 스냅샷 (입고되어야 할 수량 / 입고 수량 / 부족 수량)
--   3) ft_seller_inquiry_photos   — 첨부 사진 (Storage 공개 버킷 seller-inquiry)
--   4) updated_at 자동 갱신 트리거
--
-- 상태 전이: 접수 ──[문의중]──▶ 문의중 ──[처리완료]──▶ 처리완료 (각 전이 시각을 컬럼에 남긴다)
--   received_at = 접수 시각, inquiring_at = 문의중 전환 시각, completed_at = 처리완료 시각
--
-- 같은 사용자·같은 배송번호에 처리완료가 아닌 접수가 이미 있으면 새로 만들지 않고 그 접수의
-- 부족 목록을 최신 스냅샷으로 바꾼다 (API 가 처리). 처리완료된 뒤 다시 접수하면 새 건.
--
-- RLS: 다른 ft_* 테이블과 같이 끈다.
-- 적용 대상: 운영 DB manage-item (mkcxpkblohioqboemmah) — 1회 실행 (재실행 안전)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ft_seller_inquiries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.ft_users(id),
  team_code       text        NOT NULL,                 -- 접수 시점 user_code 스냅샷
  delivery_code   text        NOT NULL,                 -- 1688 운송장(배송) 번호
  status          text        NOT NULL DEFAULT '접수' CHECK (status IN ('접수','문의중','처리완료')),
  memo            text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  inquiring_at    timestamptz,
  completed_at    timestamptz,
  created_by      text,                                 -- 접수 작업자(Worker) 이름
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_seller_inquiries DISABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ft_seller_inquiries IS
  '1688 판매자 문의 — 배송번호 단위 미입고 접수. 부족 행 ft_seller_inquiry_items, 사진 ft_seller_inquiry_photos';

CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiries_status_received
  ON public.ft_seller_inquiries (status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiries_delivery_code
  ON public.ft_seller_inquiries (delivery_code);
CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiries_user
  ON public.ft_seller_inquiries (user_id, received_at DESC);


CREATE TABLE IF NOT EXISTS public.ft_seller_inquiry_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id      uuid        NOT NULL REFERENCES public.ft_seller_inquiries(id) ON DELETE CASCADE,
  order_item_id   uuid        REFERENCES public.ft_order_items(id) ON DELETE SET NULL,
  -- 주문행 스냅샷 (행이 지워져도 접수 내용은 남는다)
  order_no        text,
  item_no         text,
  product_no      text,
  item_name       text,
  option_name     text,
  china_option1   text,
  china_option2   text,
  img_url         text,
  site_url        text,
  order_id_1688   text,
  -- 수량: 입고되어야 할 수량(주문 − 취소) / 입고 수량(저장된 입고 + 접수 시점 작업 입력) / 부족 수량
  expected_qty    integer     NOT NULL CHECK (expected_qty >= 0),
  arrived_qty     integer     NOT NULL CHECK (arrived_qty >= 0),
  short_qty       integer     NOT NULL CHECK (short_qty >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_seller_inquiry_items DISABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ft_seller_inquiry_items IS
  '1688 판매자 문의 — 접수 시점의 부족 주문행 스냅샷';
CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiry_items_inquiry
  ON public.ft_seller_inquiry_items (inquiry_id);
CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiry_items_order_item
  ON public.ft_seller_inquiry_items (order_item_id);


CREATE TABLE IF NOT EXISTS public.ft_seller_inquiry_photos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id      uuid        NOT NULL REFERENCES public.ft_seller_inquiries(id) ON DELETE CASCADE,
  storage_path    text        NOT NULL,                 -- 버킷 seller-inquiry 안 경로
  public_url      text        NOT NULL,
  taken_by        text,                                 -- 촬영 작업자 (모바일 입력)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ft_seller_inquiry_photos DISABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ft_seller_inquiry_photos IS
  '1688 판매자 문의 — 첨부 사진 (Storage 공개 버킷 seller-inquiry)';
CREATE INDEX IF NOT EXISTS idx_ft_seller_inquiry_photos_inquiry
  ON public.ft_seller_inquiry_photos (inquiry_id, created_at);


-- ── updated_at 자동 갱신 ──
CREATE OR REPLACE FUNCTION public.ft_seller_inquiries_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ft_seller_inquiries_touch ON public.ft_seller_inquiries;
CREATE TRIGGER trg_ft_seller_inquiries_touch
  BEFORE UPDATE ON public.ft_seller_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.ft_seller_inquiries_touch_updated_at();


-- ── 공개 버킷 (이미지만, 5MB — 브라우저에서 ~500KB 로 압축 후 업로드) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-inquiry',
  'seller-inquiry',
  true,
  5 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
