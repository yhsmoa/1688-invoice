import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/hr/attendance/lookup
// 8자리 코드로 직원 조회 + 오늘 출근 기록 상태 반환
// Body: { code: string, date: string (YYYY-MM-DD) }
// Returns: { employee: { id, name, name_kr }, record: { id, clock_in, clock_out } | null }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { code, date } = await request.json();

    if (!code || !date) {
      return NextResponse.json(
        { success: false, error: '코드와 날짜가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. 코드로 직원 조회 ──────────────────────────────────
    const { data: employee, error: empError } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr')
      .eq('code', code.trim())
      .single();

    if (empError || !employee) {
      return NextResponse.json(
        { success: false, error: '코드와 일치하는 직원이 없습니다.' },
        { status: 404 }
      );
    }

    // ── 2. 오늘 날짜의 출근 기록 조회 ───────────────────────
    const { data: record } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id, clock_in, clock_out, total_minutes')
      .eq('employee_id', employee.id)
      .eq('work_date', date)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      employee,
      record: record || null,
    });

  } catch (error) {
    console.error('출퇴근 코드 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
