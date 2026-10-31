import type { LedgerWriteResult, UserTxDisplayRow } from '../../../../lib/userTransactions';

// ============================================================
// customerLedger — 고객계좌(신) 화면 공용 helper (클라이언트 전용, DB 접근 없음)
//
//   · /api/ft/users, /api/ft/user-transactions 응답 타입
//   · 수동 차감 입력값 → 검증 → 확인 문구 → 요청 본문 → 결과 알림 문구
//
//   고객계좌(신) [추가] 모달의 '차감' 탭과 주문 검사 [비용처리] → 고객기업 계좌 차감이
//   같은 규칙으로 기록하도록 한 곳에 둔다. 실제 기록·검증은 서버(lib/userTransactions.ts).
// ============================================================

// ── 포맷 ──

/** 위안 표기 */
export const fmtYuan = (n: number) => `¥${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** 오늘 (KST, YYYY-MM-DD) — 모달 날짜 기본값 */
export const todayKST = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

// ── API 응답 타입 ──

/** 드롭다운 항목 — /api/ft/users 응답 */
export interface FtUserOption {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
  username: string | null;
}

/** 드롭다운 표시명 — "아이엠몽 BZ" */
export const userLabel = (u: FtUserOption): string =>
  [u.vender_name || u.full_name || u.username, u.user_code].filter(Boolean).join(' ');

/** /api/ft/user-transactions GET 응답 */
export interface LedgerResponse {
  success: boolean;
  error?: string;
  balanceId: string | null;
  ledger: {
    rows: UserTxDisplayRow[];
    accounts: string[];
    sumBalance: number;
    snapshotBalance: number | null;
    lastDate: string | null;
    hasOpening: boolean;
  };
}

/** 기록 API 공통 응답 */
export interface WriteResponse {
  success: boolean;
  error?: string;
  committed?: boolean;
  transactionId?: string | null;
  result?: LedgerWriteResult & { orderCode?: string; itemQty?: number; orderNos1688?: number };
}

// ── 차감 입력값 ──

export interface DeductFormState {
  date: string;
  description: string;
  amount: string;
  order1688Id: string;
  deliveryFee: string;
  serviceFee: string;
  extraFee: string;
  adminNote: string;
}

export const EMPTY_DEDUCT_FORM: DeductFormState = {
  date: '', description: '', amount: '', order1688Id: '', deliveryFee: '', serviceFee: '', extraFee: '', adminNote: '',
};

/** 문자열 입력 → 숫자 (빈값·NaN 은 0) */
export const numOf = (v: string): number => (v && Number.isFinite(Number(v)) ? Number(v) : 0);

/** 입력값 기준 금액 분해 (미리보기용) — 전체금액 / 비용 합계 / 지출금액 */
export const deductAmounts = (form: DeductFormState): { amount: number; fees: number; itemAmount: number } => {
  const amount = numOf(form.amount);
  const fees = numOf(form.deliveryFee) + numOf(form.serviceFee) + numOf(form.extraFee);
  return { amount, fees, itemAmount: Math.round((amount - fees) * 100) / 100 };
};

// ── 차감 검증 → 확인 → 요청 ──

export interface DeductValues {
  amount: number;
  ship: number;
  svc: number;
  other: number;
  itemAmount: number;
  description: string;
}

/** 차감 입력 검증 — 실패하면 사용자에게 그대로 보여줄 문구를 돌려준다 */
export function validateDeductForm(form: DeductFormState): { ok: true; values: DeductValues } | { ok: false; error: string } {
  const amount = Number(form.amount);
  if (!form.amount || !(amount > 0)) return { ok: false, error: '전체금액을 입력해주세요.' };
  const description = form.description.trim();
  if (!description) return { ok: false, error: '항목을 입력해주세요.' };
  if (!form.date) return { ok: false, error: '적용일을 입력해주세요.' };
  const fee = (v: string) => (v ? Number(v) : 0);
  const ship = fee(form.deliveryFee);
  const svc = fee(form.serviceFee);
  const other = fee(form.extraFee);
  if ([ship, svc, other].some(v => !Number.isFinite(v) || v < 0)) return { ok: false, error: '배송비·서비스비·기타비용은 0 이상이어야 합니다.' };
  const itemAmount = Math.round((amount - ship - svc - other) * 100) / 100;
  if (itemAmount < 0) return { ok: false, error: '배송비·서비스비·기타비용 합계가 전체금액을 초과합니다.' };
  return { ok: true, values: { amount, ship, svc, other, itemAmount, description } };
}

/** 기록 전 confirm 문구 */
export const deductConfirmText = (userLabelText: string, form: DeductFormState, v: DeductValues): string =>
  `차감을 기록합니다.\n\n사업자: ${userLabelText}\n항목: ${v.description}\n전체금액: ${fmtYuan(v.amount)}\n` +
  `  지출 ${fmtYuan(v.itemAmount)} + 배송비 ${fmtYuan(v.ship)} + 서비스비 ${fmtYuan(v.svc)} + 기타 ${fmtYuan(v.other)}\n` +
  (form.order1688Id ? `1688 주문번호: ${form.order1688Id}\n` : '') +
  `적용일: ${form.date}\n\n진행할까요?`;

/** POST /api/ft/user-transactions (kind=deduct) 본문 */
export const deductRequestBody = (userId: string, form: DeductFormState, v: DeductValues, referenceId: string) => ({
  kind: 'deduct' as const,
  user_id: userId,
  amount: v.amount,
  applied_date: form.date,
  description: v.description,
  reference_id: referenceId,
  order_no_1688: form.order1688Id || null,
  shipping_fee: v.ship,
  service_fee: v.svc,
  other_fee: v.other,
  admin_note: form.adminNote || null,
});

/** 기록 성공 알림 문구 (충전·차감·1688 주문 공통) */
export const writeResultText = (title: string, userLabelText: string, r: LedgerWriteResult, extra = ''): string =>
  `${title}\n\n` +
  `사업자: ${userLabelText}\n` +
  `금액: ${fmtYuan(r.amount)}\n` +
  `이전 잔액: ${fmtYuan(r.prevBalance)}\n` +
  `이후 잔액: ${fmtYuan(r.newBalance)}\n` +
  `적용일: ${r.appliedDate}\n` +
  (extra ? `${extra}\n` : '') +
  `거래ID: ${r.transactionId}`;
