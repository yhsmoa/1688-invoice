import { NextRequest, NextResponse } from 'next/server';
import { fetchPayrollMonth, parseYearMonth } from '../../../../lib/payrollCalc';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/hr/payroll?year=YYYY&month=MM
//
// 특정 월의 급여장부 데이터 반환
//   조회·집계는 lib/payrollCalc (급여 엑셀·무역계좌 급여 반영과 공용)
//   → 프론트에서 날짜 × 직원 매트릭스로 처리
//
// Response:
//   { success, year, month, daysInMonth, employees, records }
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ym = parseYearMonth(searchParams.get('year'), searchParams.get('month'));
    if (!ym) {
      return NextResponse.json(
        { success: false, error: 'year, month 파라미터가 필요합니다. (유효한 년도/월)' },
        { status: 400 }
      );
    }

    const payroll = await fetchPayrollMonth(ym.year, ym.month);

    return NextResponse.json({
      success: true,
      year: payroll.year,
      month: payroll.month,
      daysInMonth: payroll.daysInMonth,
      employees: payroll.employees,
      records: payroll.records,
    });

  } catch (error) {
    console.error('급여장부 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '급여장부 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
