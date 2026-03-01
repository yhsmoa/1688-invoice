import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/hr/payroll?year=YYYY&month=MM
//
// 특정 월의 급여장부 데이터 반환
//   1. 해당 월 출퇴근 기록 조회 (invoiceManager_emplyee_records)
//   2. 해당 월 기록이 있는 직원 정보 조회 (invoiceManager_employees)
//   3. 두 데이터셋 반환 → 프론트에서 날짜 × 직원 매트릭스로 처리
//
// Response:
//   { success, year, month, daysInMonth, employees, records }
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');

    // ── 파라미터 검증 ─────────────────────────────────────────
    if (!yearParam || !monthParam) {
      return NextResponse.json(
        { success: false, error: 'year, month 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const year = parseInt(yearParam, 10);
    const month = parseInt(monthParam, 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 년도/월입니다.' },
        { status: 400 }
      );
    }

    // ── 월의 시작일 / 종료일 계산 ─────────────────────────────
    // new Date(year, month, 0).getDate() → 해당 월의 마지막 날
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    // ── 1. 해당 월 출퇴근 기록 조회 ───────────────────────────
    const { data: records, error: recordsError } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id, employee_id, work_date, clock_in, clock_out, total_minutes')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .not('clock_in', 'is', null)
      .order('work_date', { ascending: true });

    if (recordsError) throw recordsError;

    if (!records || records.length === 0) {
      return NextResponse.json({
        success: true,
        year,
        month,
        daysInMonth,
        employees: [],
        records: [],
      });
    }

    // ── 2. 해당 월 기록이 있는 직원 정보 조회 ─────────────────
    const employeeIds = [...new Set(records.map((r) => r.employee_id))];

    const { data: employees, error: employeesError } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr, hourly_wage, bank_name, bank_no')
      .in('id', employeeIds)
      .order('name');

    if (employeesError) throw employeesError;

    // ── 3. 응답 반환 ──────────────────────────────────────────
    return NextResponse.json({
      success: true,
      year,
      month,
      daysInMonth,
      employees: employees || [],
      records,
    });

  } catch (error) {
    console.error('급여장부 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '급여장부 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
