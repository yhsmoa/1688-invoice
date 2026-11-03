-- ============================================================
-- 통관정보 — invoiceManager-Customs 기본키를 id 로 교체
--
-- 화면: /export-invoice/customs-info [+ 품목 추가] ← POST /api/add-customs-item
--
-- HS CODE 를 모르는 품목도 먼저 등록할 수 있게 HS_code 를 PK 에서 내린다.
--   · id (identity) 가 새 PK
--   · HS_code 는 NULL 허용, 값이 있으면 UNIQUE 유지
--     (엑셀 업로드 upsert onConflict 'HS_code' 가 이 UNIQUE 제약을 쓴다)
--   · 이 테이블을 참조하는 FK 없음 — 읽는 쪽은 item_name_ko 기준
-- ============================================================

ALTER TABLE public."invoiceManager-Customs"
  ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE public."invoiceManager-Customs"
  DROP CONSTRAINT "invoiceManager-Customs_pkey";

ALTER TABLE public."invoiceManager-Customs"
  ADD CONSTRAINT "invoiceManager-Customs_pkey" PRIMARY KEY (id);

ALTER TABLE public."invoiceManager-Customs"
  ALTER COLUMN "HS_code" DROP NOT NULL;

ALTER TABLE public."invoiceManager-Customs"
  ADD CONSTRAINT "invoiceManager-Customs_HS_code_key" UNIQUE ("HS_code");
