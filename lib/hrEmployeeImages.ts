// ============================================================
// 직원 이미지 (얼굴 사진 · 신분증 앞/뒷면) — 서버 전용 공통 정의
//
// 저장: Supabase Storage 비공개 버킷 (supabase/hr/001_employee_images.sql)
//   · 칼럼에는 객체 경로만 저장, 화면 표시는 만료형 signed URL
//   · 읽기·쓰기는 service role(서버 API)만 — storage.objects 정책 없음
// ============================================================

/** 비공개 버킷 — 마이그레이션에서 생성 */
export const HR_DOCS_BUCKET = 'hr-employee-docs';

/** signed URL 유효 시간(초) — 상세 화면을 여는 동안만 필요 */
export const SIGNED_URL_TTL_SEC = 10 * 60;

/** 업로드 최대 용량 — 버킷 file_size_limit 과 동일 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 허용 형식 → 저장 확장자 (버킷 allowed_mime_types 와 동일) */
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// ── 이미지 종류 → 칼럼 ──
export const EMPLOYEE_IMAGE_COLUMNS = {
  photo: 'photo_path',
  id_front: 'id_card_front_path',
  id_back: 'id_card_back_path',
} as const;

export type EmployeeImageKind = keyof typeof EMPLOYEE_IMAGE_COLUMNS;

export const EMPLOYEE_IMAGE_KINDS = Object.keys(EMPLOYEE_IMAGE_COLUMNS) as EmployeeImageKind[];

export function isEmployeeImageKind(v: unknown): v is EmployeeImageKind {
  return typeof v === 'string' && v in EMPLOYEE_IMAGE_COLUMNS;
}

/** 일반 추가/수정 API 가 받지 않는 칼럼 — 이미지 API 에서만 쓴다 */
export const EMPLOYEE_IMAGE_COLUMN_NAMES: string[] = Object.values(EMPLOYEE_IMAGE_COLUMNS);
