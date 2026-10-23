import { supabase } from './supabase';

// ============================================================
// payrollPayments — 급여 지급완료 기록 (서버 전용)
//
//   DB: supabase/hr/002_payroll_payments.sql
//     · invoiceManager_payroll_payments       — 지급 묶음 ([급여지급완료] 1회)
//     · invoiceManager_payroll_payment_items  — 출근기록 1건 = 1행 (근무 분·시급 스냅샷)
//     · payroll_mark_paid / payroll_cancel_paid — 검증·잠금을 한 트랜잭션으로
//     · 지급완료된 출근기록은 트리거가 수정·삭제를 막는다
//
//   DB 오류 메시지는 'payroll: ' 접두사 + 한글 — 접두사를 떼고 화면에 그대로 보여준다.
//   CLAUDE.md §5: 월 조회는 1000행 range 루프 + 고유키(id) 정렬
// ============================================================

const PAGE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DB_MESSAGE_PREFIX = 'payroll: ';

/** 활성(취소 안 된) 지급 항목 — 급여장부 표시·월급엑셀 계산용 */
export interface PaidItem {
  record_id: string;
  payment_id: string;
  employee_id: string;
  work_date: string;
  /** 지급 시점 근무 분 */
  minutes: number;
  /** 지급 시점 시급 */
  hourly_wage: number | null;
  /** 지급일 (KST) */
  paid_date: string;
}

/** 사용자에게 그대로 보여줄 메시지를 담는 오류 (status 는 HTTP 응답 코드) */
export class PayrollPaymentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = 'PayrollPaymentError';
  }
}

// ============================================================
// DB 오류 → 화면 메시지
//   · 'payroll: ...' — DB 함수·트리거가 낸 검증 오류 → 접두사 떼고 그대로
//   · 그 외 — 서버 로그에만 남기고 일반 문구
// ============================================================
export function payrollDbMessage(message: string | undefined | null): string | null {
  if (!message) return null;
  const at = message.indexOf(DB_MESSAGE_PREFIX);
  return at >= 0 ? message.slice(at + DB_MESSAGE_PREFIX.length).trim() : null;
}

function toPaymentError(error: { message?: string } | null, fallback: string): PayrollPaymentError {
  const msg = payrollDbMessage(error?.message);
  if (msg) return new PayrollPaymentError(msg, 409);
  console.error(fallback, error);
  return new PayrollPaymentError(fallback, 500);
}

// ── 입력 정리: 문자열 UUID 만, 중복 제거 ──
export function normalizeRecordIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new PayrollPaymentError('record_ids 배열이 필요합니다.');
  const ids = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new PayrollPaymentError('출근기록 id 형식이 올바르지 않습니다.');
    ids.add(v);
  }
  if (ids.size === 0) throw new PayrollPaymentError('선택된 시간이 없습니다.');
  return [...ids];
}

// ============================================================
// 월 활성 지급 항목 조회 (work_date 범위)
// ============================================================
export async function fetchPaidItems(startDate: string, endDate: string): Promise<PaidItem[]> {
  const out: PaidItem[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('invoiceManager_payroll_payment_items')
      .select('id, record_id, payment_id, employee_id, work_date, minutes, hourly_wage, payment:invoiceManager_payroll_payments(paid_date)')
      .is('canceled_at', null)
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as unknown as {
      record_id: string | null;
      payment_id: string;
      employee_id: string;
      work_date: string;
      minutes: number;
      hourly_wage: number | null;
      payment: { paid_date: string } | { paid_date: string }[] | null;
    }[];
    if (chunk.length === 0) break;
    for (const r of chunk) {
      // 활성 항목은 record_id 가 항상 있다 (DB CHECK). 방어적으로 건너뛴다.
      if (!r.record_id) continue;
      const payment = Array.isArray(r.payment) ? r.payment[0] : r.payment;
      out.push({
        record_id: r.record_id,
        payment_id: r.payment_id,
        employee_id: r.employee_id,
        work_date: r.work_date,
        minutes: Number(r.minutes),
        hourly_wage: r.hourly_wage != null ? Number(r.hourly_wage) : null,
        paid_date: payment?.paid_date ?? '',
      });
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ============================================================
// 지급완료 — payroll_mark_paid (한 트랜잭션)
// ============================================================
export interface MarkPaidResult {
  payment_id: string;
  payroll_month: string;
  paid_date: string;
  record_count: number;
  total_minutes: number;
}

export async function markPaid(recordIds: string[], paidDate: string, note: string | null): Promise<MarkPaidResult> {
  if (!DATE_RE.test(paidDate)) throw new PayrollPaymentError('지급일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
  const { data, error } = await supabase.rpc('payroll_mark_paid', {
    p_record_ids: recordIds,
    p_paid_date: paidDate,
    p_note: note && note.trim() ? note.trim() : null,
  });
  if (error) throw toPaymentError(error, '급여 지급완료 처리 중 오류가 발생했습니다.');
  return data as MarkPaidResult;
}

// ============================================================
// 지급 취소 — payroll_cancel_paid (출근기록 단위, 이력 보존)
// ============================================================
export async function cancelPaid(recordIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('payroll_cancel_paid', { p_record_ids: recordIds });
  if (error) throw toPaymentError(error, '급여 지급 취소 중 오류가 발생했습니다.');
  return Number(data);
}
