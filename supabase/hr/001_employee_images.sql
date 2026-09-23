-- ============================================================
-- 직원 이미지 (얼굴 사진 · 신분증 앞면 · 신분증 뒷면)
--
-- 저장 위치: Supabase Storage 버킷 'hr-employee-docs' (비공개)
--   · 신분증은 민감 개인정보 → public 버킷 금지.
--   · storage.objects 에 anon/authenticated 정책을 두지 않는다 → service role(서버 API)만 접근.
--   · 화면 표시는 서버가 발급하는 만료형 signed URL 로만 한다.
--   · 객체 경로: {employee_id}/{kind}-{timestamp}.{ext}   (kind = photo | id_front | id_back)
--
-- 칼럼에는 객체 경로만 저장한다 (URL 저장 금지 — signed URL 은 만료된다).
-- 쓰기는 /api/hr/employees/[id]/images 에서만 — 일반 추가/수정 API 는 이 칼럼을 무시한다.
--
-- 적용 상태: 운영 DB(mkcxpkblohioqboemmah) 적용 완료 (2026-09-23)
-- ============================================================

-- ── 1) 이미지 경로 칼럼 ──
ALTER TABLE public."invoiceManager_employees"
  ADD COLUMN IF NOT EXISTS photo_path          text NULL,
  ADD COLUMN IF NOT EXISTS id_card_front_path  text NULL,
  ADD COLUMN IF NOT EXISTS id_card_back_path   text NULL;

COMMENT ON COLUMN public."invoiceManager_employees".photo_path IS
  '얼굴 사진 — Storage hr-employee-docs 객체 경로';
COMMENT ON COLUMN public."invoiceManager_employees".id_card_front_path IS
  '신분증 앞면 — Storage hr-employee-docs 객체 경로';
COMMENT ON COLUMN public."invoiceManager_employees".id_card_back_path IS
  '신분증 뒷면 — Storage hr-employee-docs 객체 경로';

-- ── 2) 비공개 버킷 (이미지만, 5MB 제한 — 브라우저에서 ~500KB 로 압축 후 업로드) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hr-employee-docs',
  'hr-employee-docs',
  false,
  5 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;
