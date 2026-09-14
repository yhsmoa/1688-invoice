import { supabase } from './supabase';
import { parseDeductWorksheet, DeductParseError, type DeductCalc } from './deductParser';
import * as XLSX from 'xlsx';

// ============================================================
// userTransactions — 신 원장(ft_user_transactions) 조회 + 기록 (서버 전용)
//
//   신 원장이 잔액의 **유일한** 기준이다 (2026-09-13 전환). 구 원장
//   (invoiceManager_transactions)은 읽지도 쓰지도 않는다. 대체 계산 없음 —
//   문제가 있으면 다른 값으로 대신하지 않고 즉시 오류로 알린다.
//
//   조회
//   · 스코프: 선택 사용자(ft_users.id) → ft_users.balance_id → 그 그룹의 모든 거래
//   · 잔액 2종 (합산 / 최신 balance_snapshot) — 어긋나면 화면에서 경고
//
//   기록 (모두 DB 함수 한 트랜잭션 — advisory lock, 이월 검사, 직전 스냅샷 체인, 캐시 갱신)
//   · 충전 / 수동 차감  → record_manual_transaction_v2        (supabase/ledger/001_*.sql)
//   · 1688 주문 엑셀 차감 → deduct_balance_and_record_transaction_v2 (auto-1688-order 와 동일 함수)
//   · 기록 후 반드시 재조회 검증 (스냅샷 = 직전 ± 금액). 불일치면 "기록됨·검증 실패"로 알린다.
//
//   적용일 수정 → applied_date 만 UPDATE. created_at(체인 순서)·금액은 절대 바꾸지 않는다.
//
//   CLAUDE.md §5: 전체 조회는 1000행 range 루프 + 고유키(id) 보조 정렬
// ============================================================

const PAGE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 오늘 (KST, YYYY-MM-DD) — 적용일 미래 금지 판정 */
export const todayKST = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

// ============================================================
// 타입
// ============================================================

// ── 신 원장 행 ──
export interface UserTxRow {
  id: string;
  balance_id: string | null;
  user_id: string | null;
  vender_name: string | null;
  /** 'in' = 입금(충전·환불·이월) / 'out' = 출금(구매·차감·이월) */
  type: string | null;
  /** '구매' / '차감' / '충전' / '환불' / '이월' */
  category: string | null;
  amount: number | null;
  /** DB 가 들고 있는 그 시점 누적 잔액 (클라이언트 누적 계산 불필요) */
  balance_snapshot: number | null;
  qty: number | null;
  item_amount: number | null;
  shipping_fee: number | null;
  service_fee: number | null;
  other_fee: number | null;
  description: string | null;
  reference_id: string | null;
  order_no_1688: string | null;
  admin_note: string | null;
  created_at: string;
  /** 적용날짜 — 월 귀속 기준 (화면 표시·월 필터·수정 대상) */
  applied_date: string | null;
  master_account: string | null;
  user_code: string | null;
  /** 충전 원화 금액(KRW) */
  krw_amount: number | null;
  source_table: string | null;
}

/** 화면 표시용 — user_id(uuid) 를 username 으로 풀어 붙인 행 */
export interface UserTxDisplayRow extends UserTxRow {
  account: string;
}

export interface NewLedgerResult {
  rows: UserTxDisplayRow[];
  /** 그룹에 속한 사업자 username 목록 (필터 드롭다운용) */
  accounts: string[];
  /** 합산 방식 잔액 — SUM(in +/ out -) */
  sumBalance: number;
  /** 스냅샷 방식 잔액 — 최신 행의 balance_snapshot (행 없으면 null) */
  snapshotBalance: number | null;
  /** 최종 기입일 (YYYY-MM-DD, 행 없으면 null) */
  lastDate: string | null;
  /** 이월 행 존재 여부 — 없으면 미전환 그룹 (기록 불가) */
  hasOpening: boolean;
}

export interface CustomerLedgerV2Result {
  balanceId: string | null;
  ledger: NewLedgerResult;
}

/** 기록에 필요한 사용자 정보 — 하나라도 비면 기록하지 않는다 (대체값 없음) */
export interface LedgerUser {
  id: string;
  username: string;
  vender_name: string;
  user_code: string;
  balance_id: string;
  master_account: string;
}

/** 기록 결과 — 화면 알림용 */
export interface LedgerWriteResult {
  transactionId: string;
  category: string;
  prevBalance: number;
  newBalance: number;
  amount: number;
  appliedDate: string;
}

/**
 * 원장 오류.
 *   committed=true 이면 원장에는 이미 기록됐지만 재조회 검증이 실패한 상태 —
 *   호출 측은 "완료"로 처리하지 말고 거래ID 와 함께 경고해야 한다.
 */
export class LedgerError extends Error {
  constructor(message: string, public committed = false, public transactionId: string | null = null) {
    super(message);
    this.name = 'LedgerError';
  }
}

const SELECT_FIELDS = [
  'id', 'balance_id', 'user_id', 'vender_name', 'type', 'category',
  'amount', 'balance_snapshot', 'qty', 'item_amount', 'shipping_fee',
  'service_fee', 'other_fee', 'description', 'reference_id',
  'order_no_1688', 'admin_note', 'created_at',
  'applied_date', 'master_account', 'user_code', 'krw_amount', 'source_table',
].join(', ');

// ============================================================
// 사용자 조회
// ============================================================

/** 선택 사용자 → balance_id (그룹 잔액 키). 없으면 null */
export async function resolveBalanceId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('ft_users')
    .select('balance_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as { balance_id: string | null } | null)?.balance_id ?? null;
}

/**
 * 기록용 사용자 정보 — auto-1688-order 와 같은 규칙:
 *   판매자명 / 유저코드 / 마스터계정 / balance_id 중 하나라도 비면 기록을 중단한다.
 */
export async function fetchLedgerUser(userId: string): Promise<LedgerUser> {
  if (!UUID_RE.test(userId)) throw new LedgerError(`유저 ID 형식이 올바르지 않습니다 (UUID 아님): ${userId}`);

  const { data, error } = await supabase
    .from('ft_users')
    .select('id, username, vender_name, user_code, balance_id, master_account')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LedgerError('선택한 사용자를 ft_users 에서 찾을 수 없습니다.');

  const u = data as Record<string, string | null>;
  const missing: string[] = [];
  if (!u.balance_id || !UUID_RE.test(u.balance_id)) missing.push('balance_id');
  if (!u.vender_name?.trim()) missing.push('vender_name(판매자명)');
  if (!u.user_code?.trim()) missing.push('user_code(유저코드)');
  if (!u.master_account?.trim()) missing.push('master_account(마스터계정)');
  if (!u.username?.trim()) missing.push('username');
  if (missing.length > 0) {
    throw new LedgerError(
      `유저 정보가 비어 있어 기록을 중단합니다: ${missing.join(', ')}\nft_users 를 채운 뒤 다시 시도하세요.`,
    );
  }
  return {
    id: u.id as string,
    username: u.username as string,
    vender_name: (u.vender_name as string).trim(),
    user_code: (u.user_code as string).trim(),
    balance_id: u.balance_id as string,
    master_account: (u.master_account as string).trim(),
  };
}

// ── balance_id 그룹의 사업자 목록 (uuid → username) ──
async function fetchGroupMembers(balanceId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('ft_users')
    .select('id, username')
    .eq('balance_id', balanceId);
  if (error) throw error;

  const map = new Map<string, string>();
  for (const u of (data ?? []) as { id: string; username: string | null }[]) {
    if (u.username) map.set(u.id, u.username);
  }
  return map;
}

// ============================================================
// 조회 — 신 원장 전체 + 잔액 2종
// ============================================================
async function fetchNewLedger(balanceId: string, memberMap: Map<string, string>): Promise<NewLedgerResult> {
  const empty: NewLedgerResult = {
    rows: [], accounts: Array.from(memberMap.values()).sort(),
    sumBalance: 0, snapshotBalance: null, lastDate: null, hasOpening: false,
  };

  // ── 1000행 range 루프 (created_at ASC, id ASC — 체인 순서) ──
  const all: UserTxRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ft_user_transactions')
      .select(SELECT_FIELDS)
      .eq('balance_id', balanceId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    const chunk = (data ?? []) as unknown as UserTxRow[];
    if (chunk.length === 0) break;
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  if (all.length === 0) return empty;

  const rows: UserTxDisplayRow[] = all.map(r => ({
    ...r,
    account: (r.user_id ? memberMap.get(r.user_id) : null) ?? r.vender_name ?? '-',
  }));

  const sumBalance = all.reduce((acc, r) => {
    const amt = Number(r.amount ?? 0);
    return r.type === 'in' ? acc + amt : acc - amt;
  }, 0);

  const last = all[all.length - 1];
  return {
    ...empty,
    rows,
    sumBalance,
    snapshotBalance: last.balance_snapshot != null ? Number(last.balance_snapshot) : null,
    lastDate: last.created_at ? last.created_at.slice(0, 10) : null,
    hasOpening: all.some(r => r.category === '이월'),
  };
}

/** 메인 조회 — 선택 사용자의 고객계좌(신) */
export async function fetchCustomerLedgerV2(userId: string): Promise<CustomerLedgerV2Result> {
  const balanceId = await resolveBalanceId(userId);
  if (!balanceId) {
    return {
      balanceId: null,
      ledger: { rows: [], accounts: [], sumBalance: 0, snapshotBalance: null, lastDate: null, hasOpening: false },
    };
  }
  const memberMap = await fetchGroupMembers(balanceId);
  return { balanceId, ledger: await fetchNewLedger(balanceId, memberMap) };
}

// ============================================================
// 기록 공통 — RPC 호출 후 재조회 검증
//   · RPC 는 한 트랜잭션이라 실패하면 아무것도 남지 않는다.
//   · 성공했더라도 재조회로 스냅샷 = 직전 ± 금액 을 확인한다. 불일치 = 원장 이상 신호.
//     기록은 이미 커밋됐으므로 되돌리지 않되(DELETE 금지), committed=true 로 알린다.
// ============================================================
interface RpcLedgerResult {
  transaction_id: string;
  prev_balance: number | string;
  new_balance: number | string;
  amount: number | string;
  applied_date: string;
  category?: string;
}

function friendlyRpcError(message: string): string {
  if (message.includes('duplicate reference_id')) return '같은 참조키로 이미 기록되어 있습니다 (중복 저장 차단). 화면을 새로고침해 확인하세요.';
  if (message.includes('duplicate deduction')) return '이미 차감된 주문코드입니다. 원장에 같은 주문코드의 구매 차감이 존재합니다.';
  if (message.includes('ledger not initialized')) return '이 그룹은 신 원장으로 전환되지 않았습니다 (이월 행 없음). 관리자 확인 필요.';
  if (message.includes('does not belong to balance')) return '선택한 사용자가 이 계좌 그룹에 속해 있지 않습니다.';
  if (message.includes('in the future')) return '적용일은 오늘(KST) 이후로 지정할 수 없습니다.';
  if (message.includes('exceed amount')) return '배송비·서비스비·기타비용 합계가 전체금액을 초과합니다.';
  return message;
}

async function callLedgerRpc(fn: string, params: Record<string, unknown>): Promise<RpcLedgerResult> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new LedgerError(`기록 실패 — 아무것도 기록되지 않았습니다.\n${friendlyRpcError(error.message)}`);
  if (!data || typeof data !== 'object' || !(data as RpcLedgerResult).transaction_id) {
    throw new LedgerError('기록 함수 응답이 올바르지 않습니다.');
  }
  return data as RpcLedgerResult;
}

async function verifyWrittenRow(rpc: RpcLedgerResult, signedAmount: number, category: string): Promise<LedgerWriteResult> {
  const prev = Number(rpc.prev_balance);
  const next = Number(rpc.new_balance);
  const expected = round2(prev + signedAmount);

  const { data, error } = await supabase
    .from('ft_user_transactions')
    .select('id, amount, balance_snapshot, applied_date, category')
    .eq('id', rpc.transaction_id)
    .maybeSingle();
  const row = data as { balance_snapshot: number | string; applied_date: string; category: string } | null;

  const ok = !error && !!row
    && Math.abs(Number(row.balance_snapshot) - expected) < 0.005
    && Math.abs(next - Number(row.balance_snapshot)) < 0.005;

  if (!ok) {
    throw new LedgerError(
      `⚠ 기록은 됐으나 검증에 실패했습니다. 후속 작업을 중단하고 관리자에게 거래ID 와 함께 알려주세요.\n` +
      `거래ID: ${rpc.transaction_id}\n기대 잔액: ${expected}\n원장 스냅샷: ${row ? Number(row.balance_snapshot) : `(재조회 실패: ${error?.message ?? ''})`}`,
      true,
      rpc.transaction_id,
    );
  }

  return {
    transactionId: rpc.transaction_id,
    category: row!.category ?? category,
    prevBalance: prev,
    newBalance: next,
    amount: Math.abs(signedAmount),
    appliedDate: String(row!.applied_date ?? rpc.applied_date),
  };
}

// ============================================================
// 충전 / 수동 차감 — record_manual_transaction_v2
// ============================================================
export interface ManualTxInput {
  userId: string;
  type: 'in' | 'out';
  /** 전체금액 (위안, > 0) — 차감은 배송비·서비스비·기타비용 포함 */
  amount: number;
  /** 적용일 YYYY-MM-DD (오늘 KST 이하) */
  appliedDate: string;
  /** 항목 */
  description: string;
  /** 참조키 — 화면이 저장 시도마다 만든 MANUAL-충전-… / MANUAL-차감-… (중복 저장 차단 키) */
  referenceId: string;
  adminNote?: string | null;
  // ── 차감 전용 ──
  orderNo1688?: string | null;
  shippingFee?: number | null;
  serviceFee?: number | null;
  otherFee?: number | null;
  // ── 충전 전용 ──
  krwAmount?: number | null;
}

const isFiniteNonNeg = (v: number | null | undefined) => v == null || (Number.isFinite(v) && v >= 0);

export async function recordManualTransaction(input: ManualTxInput): Promise<LedgerWriteResult> {
  // ── 서버 측 검증 (DB 함수도 같은 검사를 하지만, 메시지를 먼저 명확히) ──
  if (input.type !== 'in' && input.type !== 'out') throw new LedgerError('type 은 in 또는 out 이어야 합니다.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new LedgerError('전체금액은 0보다 커야 합니다.');
  if (!DATE_RE.test(input.appliedDate)) throw new LedgerError('적용일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
  if (input.appliedDate > todayKST()) throw new LedgerError('적용일은 오늘(KST) 이후로 지정할 수 없습니다.');
  if (!input.description?.trim()) throw new LedgerError('항목을 입력해주세요.');
  if (!input.referenceId?.trim()) throw new LedgerError('참조키가 없습니다.');

  const ship = input.shippingFee ?? 0;
  const svc = input.serviceFee ?? 0;
  const other = input.otherFee ?? 0;
  if (![ship, svc, other].every(isFiniteNonNeg)) throw new LedgerError('배송비·서비스비·기타비용은 0 이상이어야 합니다.');

  if (input.type === 'out') {
    if (round2(ship + svc + other) > round2(input.amount)) throw new LedgerError('배송비·서비스비·기타비용 합계가 전체금액을 초과합니다.');
    if (input.krwAmount != null) throw new LedgerError('원화 금액은 충전에만 입력합니다.');
  } else {
    if (ship || svc || other) throw new LedgerError('충전에는 비용 항목을 입력할 수 없습니다.');
    if (input.krwAmount != null && !(Number.isFinite(input.krwAmount) && input.krwAmount > 0)) throw new LedgerError('원화 금액은 0보다 커야 합니다.');
  }

  const user = await fetchLedgerUser(input.userId);

  const rpc = await callLedgerRpc('record_manual_transaction_v2', {
    p_balance_id: user.balance_id,
    p_user_id: user.id,
    p_vender_name: user.vender_name,
    p_type: input.type,
    p_amount: round2(input.amount),
    p_applied_date: input.appliedDate,
    p_description: input.description.trim(),
    p_reference_id: input.referenceId.trim(),
    p_order_no_1688: input.type === 'out' ? (input.orderNo1688?.trim() || null) : null,
    p_admin_note: input.adminNote?.trim() || null,
    p_shipping_fee: input.type === 'out' ? round2(ship) : 0,
    p_service_fee: input.type === 'out' ? round2(svc) : 0,
    p_other_fee: input.type === 'out' ? round2(other) : 0,
    p_krw_amount: input.type === 'in' && input.krwAmount != null ? round2(input.krwAmount) : null,
    p_master_account: user.master_account,
    p_user_code: user.user_code,
  });

  const signed = input.type === 'in' ? round2(input.amount) : -round2(input.amount);
  return verifyWrittenRow(rpc, signed, input.type === 'in' ? '충전' : '차감');
}

// ============================================================
// 1688 주문 엑셀 차감 — deduct_balance_and_record_transaction_v2 (auto-1688-order 와 동일)
//   · 엑셀 파싱 → ft_orders 존재·단일·소유자 검증 → RPC (ft_orders 가격 4필드도 같은 트랜잭션)
//   · 적용일은 함수가 KST 오늘로 기록한다. 과거 날짜가 필요하면 저장 후 적용일 수정.
// ============================================================
export interface OrderDeductResult extends LedgerWriteResult {
  orderCode: string;
  itemQty: number;
  orderNos1688: number;
  calc: DeductCalc;
}

export async function deductOrderFromExcel(userId: string, fileBuffer: Buffer): Promise<OrderDeductResult> {
  const user = await fetchLedgerUser(userId);

  // ── 파싱 ──
  let calc: DeductCalc;
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) throw new DeductParseError('엑셀 시트가 비어 있습니다.');
    calc = parseDeductWorksheet(worksheet, { selectedUserCode: user.user_code });
  } catch (e) {
    if (e instanceof DeductParseError) throw new LedgerError(e.message);
    throw e;
  }

  // ── ft_orders 조회 + 소유자 검증 (중복이면 임의 선택하지 않고 중단) ──
  const { data: orders, error: findError } = await supabase
    .from('ft_orders')
    .select('id, user_id, status')
    .eq('order_no', calc.orderCode)
    .order('created_at', { ascending: false });
  if (findError) throw new LedgerError(`ft_orders 조회 실패: ${findError.message}`);
  const list = (orders ?? []) as { id: string; user_id: string | null; status: string | null }[];
  if (list.length === 0) {
    throw new LedgerError(`ft_orders 에 주문코드(${calc.orderCode})가 없습니다.\n먼저 상품입고(V2 이전 저장)를 진행해주세요.`);
  }
  if (list.length > 1) {
    throw new LedgerError(`ft_orders 에 주문코드(${calc.orderCode})가 ${list.length}건 중복되어 있어 차감을 중단합니다.\n관리자가 중복 행을 정리한 뒤 다시 시도하세요.`);
  }
  const order = list[0];
  if (order.user_id && order.user_id !== user.id) {
    throw new LedgerError(`이 주문(${calc.orderCode})은 선택된 유저의 주문이 아닙니다.\n주문 user_id: ${order.user_id}`);
  }

  const rpc = await callLedgerRpc('deduct_balance_and_record_transaction_v2', {
    p_balance_id: user.balance_id,
    p_user_id: user.id,
    p_vender_name: user.vender_name,
    p_amount: calc.amount,
    p_qty: calc.item_qty,
    p_item_amount: calc.price,
    p_shipping_fee: calc.delivery_fee,
    p_service_fee: calc.service_fee,
    p_other_fee: 0,
    p_description: `${calc.orderCode} 주문`,
    p_reference_id: calc.orderCode,
    p_order_no_1688: calc.orderNos1688.length ? calc.orderNos1688.join(', ') : null,
    p_admin_note: null,
    p_master_account: user.master_account,
    p_user_code: user.user_code,
    p_order_id: order.id,
  });

  const verified = await verifyWrittenRow(rpc, -calc.amount, '구매');
  return { ...verified, orderCode: calc.orderCode, itemQty: calc.item_qty, orderNos1688: calc.orderNos1688.length, calc };
}

// ============================================================
// 적용일 수정 — applied_date 만. created_at(체인)·금액은 건드리지 않는다.
// ============================================================
export async function updateAppliedDate(id: string, appliedDate: string): Promise<{ id: string; applied_date: string }> {
  if (!UUID_RE.test(id)) throw new LedgerError('거래 id 형식이 올바르지 않습니다.');
  if (!DATE_RE.test(appliedDate)) throw new LedgerError('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');
  if (appliedDate > todayKST()) throw new LedgerError('적용일은 오늘(KST) 이후로 지정할 수 없습니다.');

  const { data, error } = await supabase
    .from('ft_user_transactions')
    .update({ applied_date: appliedDate })
    .eq('id', id)
    .select('id, applied_date')
    .maybeSingle();
  if (error) throw new LedgerError(`적용일 수정 실패: ${error.message}`);
  if (!data) throw new LedgerError('해당 거래를 찾을 수 없습니다.');
  return data as { id: string; applied_date: string };
}
