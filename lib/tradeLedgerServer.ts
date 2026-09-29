import { supabase } from './supabase';
import type { BankCheck, PendingRefunds, TradeRow, TradeStatus } from './tradeLedger';

// ============================================================
// tradeLedgerServer — 무역계좌 조회·기록 (서버 전용)
//
//   기록은 전부 DB 함수(supabase/trade/001_trade_ledger.sql)로만 한다.
//   여기서는 rpc 호출과 오류 문구 변환, 1000행 range 루프 조회만 담당.
// ============================================================

const PAGE = 1000;

export class TradeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'TradeError';
  }
}

const ROW_SELECT = [
  'id', 'created_at', 'applied_date', 'kind', 'category',
  'bank_delta', 'customer_delta', 'asset_delta', 'pnl_delta',
  'bank_balance', 'customer_balance', 'asset_balance',
  'amount', 'krw_amount', 'description', 'reference_id',
  'user_tx_id', 'balance_id', 'reverses_id',
  'employee_id', 'payroll_month', 'expected_amount', 'admin_note', 'created_by',
].join(', ');

/** DB 함수 예외 → 사용자 문구 */
export function friendlyTradeError(message: string): string {
  if (message.includes('duplicate reference_id')) return '같은 참조키로 이미 기록되어 있습니다 (중복 저장 차단). 화면을 새로고침해 확인하세요.';
  if (message.includes('already opened')) return '무역계좌는 이미 이월이 설정되어 있습니다.';
  if (message.includes('not opened')) return '무역계좌 이월이 아직 설정되지 않았습니다. 먼저 통장잔고로 이월을 입력하세요.';
  if (message.includes('in the future')) return '적용일은 오늘(KST) 이후로 지정할 수 없습니다.';
  if (message.includes('already reversed')) return '이미 취소된 행입니다.';
  if (message.includes('only company rows')) return '고객 원장에서 온 행은 여기서 취소할 수 없습니다. 고객계좌(신)에서 반대 거래로 처리하세요.';
  if (message.includes('needs a reason')) return '환차·보정은 사유(비고)를 반드시 입력해야 합니다.';
  if (message.includes('needs type')) return '환차·보정은 입금/출금 방향을 골라야 합니다.';
  if (message.includes('amount must be > 0')) return '금액은 0보다 커야 합니다.';
  if (message.includes('unknown category')) return '알 수 없는 구분입니다.';
  return message;
}

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new TradeError(friendlyTradeError(error.message));
  return data as T;
}

const num = (v: unknown): number => Number(v ?? 0);

// ============================================================
// 상태 — 이월·그룹·마지막 스냅샷·정합 근거
// ============================================================
export async function fetchTradeStatus(): Promise<TradeStatus> {
  const [settingsRes, groupsRes, lastRes, pendingRes, checkRes] = await Promise.all([
    supabase.from('ft_trade_settings').select('started_at, opening_bank').eq('id', 1).maybeSingle(),
    supabase.from('ft_trade_groups').select('balance_id, included_from'),
    supabase.from('ft_trade_transactions')
      .select('bank_balance, customer_balance, asset_balance, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .limit(1).maybeSingle(),
    supabase.rpc('trade_pending_refunds'),
    supabase.from('ft_trade_bank_checks')
      .select('id, checked_at, applied_date, actual_bank, ledger_bank, diff, adjustment_id, note, created_by')
      .order('checked_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if (lastRes.error) throw lastRes.error;
  if (pendingRes.error) throw pendingRes.error;
  if (checkRes.error) throw checkRes.error;

  const pendingRaw = pendingRes.data as Record<string, unknown> | null;
  const pendingRefunds: PendingRefunds | null = pendingRaw ? {
    done_count: num(pendingRaw.done_count), done_seller: num(pendingRaw.done_seller), done_service: num(pendingRaw.done_service),
    processing_count: num(pendingRaw.processing_count), processing_seller: num(pendingRaw.processing_seller), processing_service: num(pendingRaw.processing_service),
    pending_count: num(pendingRaw.pending_count), other_count: num(pendingRaw.other_count),
  } : null;

  const checkRaw = checkRes.data as Record<string, unknown> | null;
  const lastBankCheck: BankCheck | null = checkRaw ? {
    id: String(checkRaw.id), checked_at: String(checkRaw.checked_at), applied_date: String(checkRaw.applied_date),
    actual_bank: num(checkRaw.actual_bank), ledger_bank: num(checkRaw.ledger_bank), diff: num(checkRaw.diff),
    adjustment_id: checkRaw.adjustment_id ? String(checkRaw.adjustment_id) : null,
    note: checkRaw.note ? String(checkRaw.note) : null, created_by: checkRaw.created_by ? String(checkRaw.created_by) : null,
  } : null;

  const settings = settingsRes.data as { started_at: string; opening_bank: number } | null;
  const groupRows = (groupsRes.data ?? []) as { balance_id: string; included_from: string }[];

  // 그룹 이름 + 고객 원장 현재 스냅샷 (ft_balances)
  let groups: TradeStatus['groups'] = [];
  let ledgerCustomerBalance: number | null = null;
  if (groupRows.length > 0) {
    const { data: bal, error } = await supabase
      .from('ft_balances')
      .select('id, name, balance')
      .in('id', groupRows.map((g) => g.balance_id));
    if (error) throw error;
    const byId = new Map((bal ?? []).map((b) => [b.id as string, b as { name: string | null; balance: number | null }]));
    groups = groupRows.map((g) => ({
      balanceId: g.balance_id,
      name: byId.get(g.balance_id)?.name ?? g.balance_id,
      includedFrom: g.included_from,
    }));
    ledgerCustomerBalance = groupRows.reduce((acc, g) => acc + num(byId.get(g.balance_id)?.balance), 0);
  }

  // Σ bank_delta — 행 수가 적어 전체 합산 (1000행 넘으면 range 루프)
  let sumBank: number | null = null;
  let rowCount = 0;
  {
    let from = 0;
    let acc = 0;
    while (true) {
      const { data, error } = await supabase
        .from('ft_trade_transactions')
        .select('bank_delta')
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) acc += num((r as { bank_delta: unknown }).bank_delta);
      rowCount += data.length;
      if (data.length < PAGE) break;
      from += PAGE;
    }
    sumBank = rowCount > 0 ? Math.round(acc * 100) / 100 : null;
  }

  const last = lastRes.data as { bank_balance: number; customer_balance: number; asset_balance: number; created_at: string } | null;
  return {
    opened: !!settings,
    startedAt: settings?.started_at ?? null,
    openingBank: settings ? num(settings.opening_bank) : null,
    groups,
    bankBalance: last ? num(last.bank_balance) : null,
    customerBalance: last ? num(last.customer_balance) : null,
    assetBalance: last ? num(last.asset_balance) : null,
    lastAt: last?.created_at ?? null,
    ledgerCustomerBalance,
    sumBank,
    rowCount,
    pendingRefunds,
    lastBankCheck,
  };
}

// ============================================================
// 통장 대조 — 실제 통장잔고 입력 → 차이 기록 (+ 선택 보정)
// ============================================================
export interface BankCheckResult {
  check_id: string;
  checked_at: string;
  actual_bank: number;
  ledger_bank: number;
  diff: number;
  adjustment_id: string | null;
}

export function bankCheck(actualBank: number, adjust: boolean, note: string | null, createdBy: string): Promise<BankCheckResult> {
  return rpc<BankCheckResult>('trade_bank_check', { p_actual_bank: actualBank, p_adjust: adjust, p_note: note, p_created_by: createdBy });
}

/** 최근 통장 대조 이력 */
export async function fetchBankChecks(limit = 12): Promise<BankCheck[]> {
  const { data, error } = await supabase
    .from('ft_trade_bank_checks')
    .select('id, checked_at, applied_date, actual_bank, ledger_bank, diff, adjustment_id, note, created_by')
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), checked_at: String(r.checked_at), applied_date: String(r.applied_date),
    actual_bank: num(r.actual_bank), ledger_bank: num(r.ledger_bank), diff: num(r.diff),
    adjustment_id: r.adjustment_id ? String(r.adjustment_id) : null,
    note: r.note ? String(r.note) : null, created_by: r.created_by ? String(r.created_by) : null,
  }));
}

// ============================================================
// 원장 조회 — 적용일 구간, 체인 순서(created_at, id) 오름차순
// ============================================================
export async function fetchTradeRows(from: string | null, to: string | null): Promise<TradeRow[]> {
  const rows: TradeRow[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('ft_trade_transactions')
      .select(ROW_SELECT)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (from) q = q.gte('applied_date', from);
    if (to) q = q.lte('applied_date', to);
    const { data, error } = await q;
    if (error) throw error;
    const chunk = (data ?? []) as unknown as Omit<TradeRow, 'reversed_by'>[];
    if (chunk.length === 0) break;
    rows.push(...chunk.map((r) => ({ ...r, reversed_by: null })));
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }

  // ── 취소 관계: 구간 밖의 취소 행도 찾아 표시 ──
  const ids = rows.filter((r) => r.kind === 'company').map((r) => r.id);
  if (ids.length > 0) {
    const BATCH = 100;
    const map = new Map<string, string>();
    for (let i = 0; i < ids.length; i += BATCH) {
      const { data, error } = await supabase
        .from('ft_trade_transactions')
        .select('id, reverses_id')
        .in('reverses_id', ids.slice(i, i + BATCH));
      if (error) throw error;
      for (const r of (data ?? []) as { id: string; reverses_id: string }[]) map.set(r.reverses_id, r.id);
    }
    for (const r of rows) r.reversed_by = map.get(r.id) ?? null;
  }

  return rows.map((r) => ({
    ...r,
    bank_delta: num(r.bank_delta), customer_delta: num(r.customer_delta),
    asset_delta: num(r.asset_delta), pnl_delta: num(r.pnl_delta),
    bank_balance: num(r.bank_balance), customer_balance: num(r.customer_balance),
    asset_balance: num(r.asset_balance), amount: num(r.amount),
    krw_amount: r.krw_amount == null ? null : num(r.krw_amount),
    expected_amount: r.expected_amount == null ? null : num(r.expected_amount),
  }));
}

// ============================================================
// 기록 (rpc)
// ============================================================
export interface OpenResult {
  transaction_id: string;
  started_at: string;
  bank_balance: number;
  customer_balance: number;
  asset_balance: number;
}

export function openTradeLedger(bankBalance: number, balanceId: string, createdBy: string): Promise<OpenResult> {
  return rpc<OpenResult>('trade_open', { p_bank_balance: bankBalance, p_balance_id: balanceId, p_created_by: createdBy });
}

export interface CompanyRowInput {
  applied_date: string;
  category: string;
  type?: 'in' | 'out' | null;
  amount: number;
  krw_amount?: number | null;
  description: string;
  reference_id: string;
  admin_note?: string | null;
}

export function recordCompanyRows(rows: CompanyRowInput[], createdBy: string): Promise<string[]> {
  return rpc<string[]>('trade_record', { p_rows: rows, p_created_by: createdBy });
}

export interface PayrollRowInput {
  employee_id: string;
  name: string;
  amount: number;
  expected_amount: number | null;
}

export function recordPayroll(month: string, paidDate: string, rows: PayrollRowInput[], createdBy: string): Promise<string[]> {
  return rpc<string[]>('trade_record_payroll', { p_month: month, p_paid_date: paidDate, p_rows: rows, p_created_by: createdBy });
}

export function reverseTradeRow(id: string, reason: string, createdBy: string): Promise<string> {
  return rpc<string>('trade_reverse', { p_id: id, p_reason: reason, p_created_by: createdBy });
}

export async function fetchTradePnl(unit: 'day' | 'month', from: string | null, to: string | null) {
  return rpc<unknown[]>('trade_pnl', { p_unit: unit, p_from: from, p_to: to });
}

/** 급여: 이미 기록된 행 (귀속월 기준, 취소되지 않은 것) */
export async function fetchRecordedPayroll(month: string): Promise<Map<string, { id: string; amount: number; appliedDate: string }>> {
  const { data, error } = await supabase
    .from('ft_trade_transactions')
    .select('id, employee_id, amount, applied_date, kind')
    .eq('payroll_month', month)
    .eq('category', '급여');
  if (error) throw error;
  const rows = (data ?? []) as { id: string; employee_id: string; amount: unknown; applied_date: string; kind: string }[];
  const reversed = new Set<string>();
  // 취소 행이 있으면 원본은 "미기록" 으로 본다 (다시 기록 가능하도록 참조키는 다르므로 REV- 로 구분)
  const { data: revs, error: revErr } = await supabase
    .from('ft_trade_transactions')
    .select('reverses_id')
    .eq('payroll_month', month)
    .eq('kind', 'reversal');
  if (revErr) throw revErr;
  for (const r of (revs ?? []) as { reverses_id: string | null }[]) if (r.reverses_id) reversed.add(r.reverses_id);

  const map = new Map<string, { id: string; amount: number; appliedDate: string }>();
  for (const r of rows) {
    if (r.kind !== 'company' || reversed.has(r.id)) continue;
    map.set(r.employee_id, { id: r.id, amount: num(r.amount), appliedDate: r.applied_date });
  }
  return map;
}
