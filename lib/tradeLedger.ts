// ============================================================
// tradeLedger — 무역계좌 공용 타입·상수 (서버·클라이언트 공용, DB 접근 없음)
//
//   통장잔고 = 회사자산 + 고객 충전금(immong)
//   DB: ft_trade_transactions (supabase/trade/001_trade_ledger.sql)
// ============================================================

// ── 행 종류 ──
export type TradeKind = 'opening' | 'customer' | 'company' | 'reversal';

export const TRADE_KIND_LABEL: Record<TradeKind, string> = {
  opening: '이월',
  customer: '고객원장',
  company: '회사',
  reversal: '취소',
};

// ── 회사 행 카테고리 (trade_record 가 받는 것) ──
export const EXPENSE_CATEGORIES = ['전기세', '수도가스', '임대료', '통신비', '소모품', '물류비', '세금수수료', '기타경비'] as const;
export const CAPITAL_CATEGORIES = ['인출', '자본투입'] as const;
export const ADJUST_CATEGORIES = ['환차', '보정'] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type CapitalCategory = (typeof CAPITAL_CATEGORIES)[number];
export type AdjustCategory = (typeof ADJUST_CATEGORIES)[number];
export type CompanyCategory = ExpenseCategory | CapitalCategory | AdjustCategory;

export const COMPANY_CATEGORIES: readonly CompanyCategory[] = [
  ...EXPENSE_CATEGORIES,
  ...CAPITAL_CATEGORIES,
  ...ADJUST_CATEGORIES,
];

/** 방향이 정해진 카테고리 — 환차·보정은 사용자가 in/out 을 고른다 */
export const CATEGORY_DIRECTION: Partial<Record<string, 'in' | 'out'>> = {
  전기세: 'out', 수도가스: 'out', 임대료: 'out', 통신비: 'out',
  소모품: 'out', 물류비: 'out', 세금수수료: 'out', 기타경비: 'out',
  인출: 'out', 자본투입: 'in', 급여: 'out',
};

export const isAdjustCategory = (c: string): c is AdjustCategory =>
  (ADJUST_CATEGORIES as readonly string[]).includes(c);

// ── 화면 구분 필터 ──
export type LedgerFilter = 'all' | 'customer' | 'payroll' | 'expense' | 'capital' | 'adjust';

export const LEDGER_FILTER_LABEL: Record<LedgerFilter, string> = {
  all: '전체',
  customer: '고객거래',
  payroll: '급여',
  expense: '경비',
  capital: '인출·자본',
  adjust: '환차·보정',
};

/** 행이 어느 필터에 속하는지 */
export function ledgerFilterOf(row: { kind: TradeKind; category: string }): LedgerFilter {
  if (row.kind === 'customer') return 'customer';
  if (row.category === '급여') return 'payroll';
  if ((CAPITAL_CATEGORIES as readonly string[]).includes(row.category)) return 'capital';
  if ((ADJUST_CATEGORIES as readonly string[]).includes(row.category)) return 'adjust';
  return 'expense';
}

// ── 원장 행 (ft_trade_transactions) ──
export interface TradeRow {
  id: string;
  created_at: string;
  applied_date: string;
  kind: TradeKind;
  category: string;
  bank_delta: number;
  customer_delta: number;
  asset_delta: number;
  pnl_delta: number;
  bank_balance: number;
  customer_balance: number;
  asset_balance: number;
  amount: number;
  krw_amount: number | null;
  description: string;
  reference_id: string;
  user_tx_id: string | null;
  balance_id: string | null;
  reverses_id: string | null;
  employee_id: string | null;
  payroll_month: string | null;
  expected_amount: number | null;
  admin_note: string | null;
  created_by: string | null;
  /** 이 행을 취소한 행 id (조회 시 계산) */
  reversed_by: string | null;
}

// ── 상태 ──
export interface TradeStatus {
  opened: boolean;
  startedAt: string | null;
  openingBank: number | null;
  /** 미러링 대상 고객 그룹 */
  groups: { balanceId: string; name: string; includedFrom: string }[];
  /** 마지막 행 스냅샷 */
  bankBalance: number | null;
  customerBalance: number | null;
  assetBalance: number | null;
  lastAt: string | null;
  /** 고객 원장 현재 스냅샷 (ft_balances) — customerBalance 와 같아야 정합 */
  ledgerCustomerBalance: number | null;
  /** Σ bank_delta (이월 포함) — bankBalance 와 같아야 정합 */
  sumBank: number | null;
  rowCount: number;
}

// ── 손익 (trade_pnl) ──
export interface TradePnlRow {
  period_start: string;
  n: number;
  gmv: number;
  charges: number;
  refunds: number;
  service_income: number;
  refund_service: number;
  payroll: number;
  utilities: number;
  other_expense: number;
  adjustments: number;
  net: number;
  bank_in: number;
  bank_out: number;
  capital_flow: number;
  bank_end: number;
  customer_end: number;
  asset_end: number;
}

// ── 급여 미리보기 ──
export interface PayrollPreviewRow {
  employeeId: string;
  name: string;
  nameKr: string | null;
  role: string | null;
  hourlyWage: number | null;
  totalMinutes: number;
  expectedAmount: number;
  /** 이미 무역계좌에 기록된 행 (있으면 잠금) */
  recorded: { id: string; amount: number; appliedDate: string } | null;
}

// ── 포맷 ──
export const fmtYuan = (n: number | null | undefined, digits = 2): string =>
  n == null ? '—' : `¥${n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;

export const fmtSigned = (n: number | null | undefined): string => {
  if (n == null) return '';
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
};

/** 오늘 (KST, YYYY-MM-DD) */
export const todayKST = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 이익률(%) — 분모 0 이면 null */
export const marginPct = (net: number, base: number): number | null =>
  base > 0 ? Math.round((net / base) * 1000) / 10 : null;
