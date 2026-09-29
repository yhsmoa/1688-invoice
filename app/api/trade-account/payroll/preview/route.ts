import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../../lib/dbAccess';
import { calcSalary, fetchPayrollMonth, parseYearMonth } from '../../../../../lib/payrollCalc';
import { fetchRecordedPayroll } from '../../../../../lib/tradeLedgerServer';
import type { PayrollPreviewRow } from '../../../../../lib/tradeLedger';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/trade-account/payroll/preview?year&month
//   급여장부와 같은 계산(lib/payrollCalc)으로 직원별 예상 급여 + 이미 기록된 행
//   · 시급 0(기업 역할) · 근무 0분 직원은 제외
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const ym = parseYearMonth(searchParams.get('year'), searchParams.get('month'));
    if (!ym) return NextResponse.json({ success: false, error: '유효한 년도/월이 필요합니다.' }, { status: 400 });

    const monthKey = `${ym.year}-${String(ym.month).padStart(2, '0')}-01`;
    const [payroll, recorded] = await Promise.all([fetchPayrollMonth(ym.year, ym.month), fetchRecordedPayroll(monthKey)]);

    const rows: PayrollPreviewRow[] = payroll.employees
      .map((emp) => {
        const totalMinutes = payroll.minutesByEmployee.get(emp.id) ?? 0;
        return {
          employeeId: emp.id,
          name: emp.name || emp.name_kr || emp.id,
          nameKr: emp.name_kr,
          role: emp.role,
          hourlyWage: emp.hourly_wage,
          totalMinutes,
          expectedAmount: calcSalary(emp.hourly_wage, totalMinutes),
          recorded: recorded.get(emp.id) ?? null,
        };
      })
      .filter((r) => r.expectedAmount > 0 || r.recorded);

    return NextResponse.json({ success: true, year: ym.year, month: ym.month, monthKey, rows });
  } catch (error) {
    console.error('무역계좌 급여 미리보기 오류:', error);
    return NextResponse.json({ success: false, error: '급여 미리보기 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
