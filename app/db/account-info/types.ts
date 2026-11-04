// ============================================================
// 계좌정보 — 타입 · 입력 필드 정의
//   DB: ft_account_info (supabase/account/001_account_info.sql)
//   API: /api/db/account-info
// ============================================================

/** ft_account_info 1행 (API 응답) */
export interface AccountInfo {
  id: string;
  company_name: string | null;
  name: string | null;
  phone: string | null;
  bank_name: string | null;
  account_no: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 입력폼 값 — 모두 문자열(빈 값 = '') */
export interface AccountInfoForm {
  company_name: string;
  name: string;
  phone: string;
  bank_name: string;
  account_no: string;
  note: string;
}

export type AccountInfoField = keyof AccountInfoForm;

// ── 화면 표시 순서 · 라벨 (입력폼 · 표 공용) ──
export const ACCOUNT_FIELDS: { key: AccountInfoField; label: string }[] = [
  { key: 'company_name', label: '회사이름' },
  { key: 'name', label: '이름' },
  { key: 'phone', label: '연락처' },
  { key: 'bank_name', label: '은행' },
  { key: 'account_no', label: '계좌번호' },
  { key: 'note', label: '비고' },
];

/** 비고를 뺀 정보 필드 — 하나 이상 입력해야 저장 (API 와 같은 규칙) */
export const INFO_FIELDS: readonly AccountInfoField[] = ['company_name', 'name', 'phone', 'bank_name', 'account_no'];

export const EMPTY_FORM: AccountInfoForm = {
  company_name: '',
  name: '',
  phone: '',
  bank_name: '',
  account_no: '',
  note: '',
};

/** 목록 행 → 입력폼 값 (수정 시작 시) */
export const toForm = (a: AccountInfo): AccountInfoForm => ({
  company_name: a.company_name ?? '',
  name: a.name ?? '',
  phone: a.phone ?? '',
  bank_name: a.bank_name ?? '',
  account_no: a.account_no ?? '',
  note: a.note ?? '',
});
