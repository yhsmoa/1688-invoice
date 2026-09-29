import { NextRequest, NextResponse } from 'next/server';
import { requireDbAccess } from '../../../../../lib/dbAccess';
import { recordPayroll, TradeError, type PayrollRowInput } from '../../../../../lib/tradeLedgerServer';
import { todayKST } from '../../../../../lib/tradeLedger';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// POST /api/trade-account/payroll/commit
//   Body: { month: 'YYYY-MM-01', paid_date: 'YYYY-MM-DD', rows: [{ employee_id, name, amount, expected_amount }] }
//   직원별 실지급액을 한 트랜잭션으로 기록 (rpc trade_record_payroll)
//   같은 달·같은 직원은 참조키 PAYROLL-YYYYMM-{employee} 로 중복 차단
// ============================================================
export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const month = String(body?.month ?? '');
    const paidDate = String(body?.paid_date ?? '');
    if (!DATE_RE.test(month)) throw new TradeError('귀속월 형식이 올바르지 않습니다.');
    if (!DATE_RE.test(paidDate)) throw new TradeError('지급일 형식이 올바르지 않습니다.');
    if (paidDate > todayKST()) throw new TradeError('지급일은 오늘(KST) 이후로 지정할 수 없습니다.');

    const raw = Array.isArray(body?.rows) ? (body.rows as Record<string, unknown>[]) : [];
    if (raw.length === 0) throw new TradeError('기록할 직원이 없습니다.');

    const rows: PayrollRowInput[] = raw.map((r) => {
      const employeeId = String(r.employee_id ?? '');
      if (!UUID_RE.test(employeeId)) throw new TradeError('직원 id 가 올바르지 않습니다.');
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new TradeError(`${String(r.name ?? employeeId)}: 실지급액은 0보다 커야 합니다.`);
      const expected = r.expected_amount == null ? null : Number(r.expected_amount);
      return {
        employee_id: employeeId,
        name: String(r.name ?? '').trim(),
        amount: Math.round(amount * 100) / 100,
        expected_amount: expected != null && Number.isFinite(expected) ? expected : null,
      };
    });
    if (new Set(rows.map((r) => r.employee_id)).size !== rows.length) throw new TradeError('같은 직원이 두 번 포함되어 있습니다.');

    const ids = await recordPayroll(month, paidDate, rows, access.employeeId);
    return NextResponse.json({ success: true, ids });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('무역계좌 급여 기록 오류:', error);
    return NextResponse.json({ success: false, error: '급여 기록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
