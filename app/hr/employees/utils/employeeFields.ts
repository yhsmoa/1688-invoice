// ============================================================
// 직원관리 — 타입 · 필드 정의 · 선택지
// ============================================================

// ── 직원 행 (invoiceManager_employees) ──
export interface Employee {
  id: string;
  created_at: string;
  name: string | null;
  name_kr: string | null;
  identification: string | null;
  birth_date: string | null;
  phone: string | null;
  address: string | null;
  wechat: string | null;
  hourly_wage: number | null;
  status: string | null;
  hire_date: string | null;
  resigned_date: string | null;
  bank_name: string | null;
  bank_no: string | null;
  role: string | null;
  note: string | null;
  access_authorization: boolean | null;
  code: string | null;
  /** Storage 객체 경로 — 표시는 /api/hr/employees/[id]/images 의 signed URL 로 */
  photo_path: string | null;
  id_card_front_path: string | null;
  id_card_back_path: string | null;
}

/** 추가·수정 폼에서 다루는 필드 (서버 관리 칼럼·이미지 경로 제외) */
export type EditableFields = Omit<
  Employee,
  'id' | 'created_at' | 'access_authorization' | 'code' | 'photo_path' | 'id_card_front_path' | 'id_card_back_path'
>;

export const EMPTY_FORM: EditableFields = {
  name: '',
  name_kr: '',
  identification: '',
  birth_date: '',
  phone: '',
  address: '',
  wechat: '',
  hourly_wage: null,
  status: '',
  hire_date: '',
  resigned_date: '',
  bank_name: '',
  bank_no: '',
  role: '',
  note: '',
};

/** 상세 → 수정 폼 초기값 */
export const toEditableFields = (e: Employee): EditableFields => ({
  name: e.name || '',
  name_kr: e.name_kr || '',
  identification: e.identification || '',
  birth_date: e.birth_date || '',
  phone: e.phone || '',
  address: e.address || '',
  wechat: e.wechat || '',
  hourly_wage: e.hourly_wage,
  status: e.status || '',
  hire_date: e.hire_date || '',
  resigned_date: e.resigned_date || '',
  bank_name: e.bank_name || '',
  bank_no: e.bank_no || '',
  role: e.role || '',
  note: e.note || '',
});

// ============================================================
// 필드 순서 — 라벨은 i18n: hr.employees.fields.<field>
// ============================================================

/** 상세 보기 순서 */
export const DETAIL_FIELDS: (keyof Employee)[] = [
  'name', 'name_kr', 'role', 'status',
  'birth_date', 'phone', 'wechat', 'address',
  'identification', 'hourly_wage',
  'hire_date', 'resigned_date',
  'bank_name', 'bank_no',
  'note', 'access_authorization', 'created_at',
];

/** 추가·수정 입력 순서 (access_authorization, code, id, created_at 제외) */
export const EDIT_FIELDS: (keyof EditableFields)[] = [
  'name', 'name_kr', 'role', 'status',
  'birth_date', 'phone', 'wechat', 'address',
  'identification', 'hourly_wage',
  'hire_date', 'resigned_date',
  'bank_name', 'bank_no', 'note',
];

export const DATE_FIELDS = new Set<string>(['birth_date', 'hire_date', 'resigned_date']);
export const NUMBER_FIELDS = new Set<string>(['hourly_wage']);
/** 2열 그리드에서 한 줄 전체를 쓰는 필드 */
export const WIDE_FIELDS = new Set<string>(['address', 'note']);

// ============================================================
// 선택지 — 값(DB 저장)은 한국어 그대로, 표시는 i18n
//   · 직책 값은 다른 기능이 참조한다: '매니저'/'검수' → /api/hr/workers,
//     '포장'/'검수' → /api/db/volume-weekly, '기업' → lib/dbAccess.ts
// ============================================================
export const ROLE_OPTIONS = [
  { value: '매니저', labelKey: 'manager' },
  { value: '검수', labelKey: 'inspection' },
  { value: '포장', labelKey: 'packing' },
  { value: '단기 아르바이트', labelKey: 'partTime' },
] as const;

/** 선택지에는 없지만 기존 데이터에 있는 직책 — 수정 시 값이 사라지지 않게 표시만 한다 */
export const LEGACY_ROLE_LABEL_KEYS: Record<string, string> = {
  기업: 'company',
};

export const STATUS_OPTIONS = ['WORKING', 'RESIGNED'] as const;

// ============================================================
// 목록 정렬 — 상태(WORKING→RESIGNED) → 직책 → 입사일(오름차순)
// ============================================================
export const STATUS_ORDER: Record<string, number> = { WORKING: 0, RESIGNED: 1 };
export const ROLE_ORDER: Record<string, number> = {
  기업: 0, 매니저: 1, 검수: 2, 포장: 3, '단기 아르바이트': 4,
};
export const rankOf = (order: Record<string, number>, value: string | null): number =>
  value != null && order[value] !== undefined ? order[value] : 99;

// ============================================================
// 이미지 종류 — 서버 lib/hrEmployeeImages.ts 의 kind 와 동일
// ============================================================
export const IMAGE_KINDS = ['photo', 'id_front', 'id_back'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

// ============================================================
// 표시 포맷
// ============================================================
export const formatDate = (date: string | null) => (date ? date.split('T')[0] : '-');

/** 생년월일 → "YYYY-MM-DD (만 나이)" */
export const formatBirthWithAge = (date: string | null) => {
  if (!date) return '-';
  const d = date.split('T')[0];
  const birth = new Date(d);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${d} (${age})`;
};
