import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/hr/attendance/clock-in
// 출근 기록 생성
// Body: { employee_id: string, date: string (YYYY-MM-DD) }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { employee_id, date } = await request.json();

    if (!employee_id || !date) {
      return NextResponse.json(
        { success: false, error: '직원 ID와 날짜가 필요합니다.' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // ── 중복 출근 방지: 오늘 이미 기록이 있으면 차단 ────────
    const { data: existing } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('work_date', date)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: '오늘 이미 출근 기록이 있습니다.' },
        { status: 409 }
      );
    }

    // ── 출근 기록 생성 ───────────────────────────────────────
    const { data, error } = await supabase
      .from('invoiceManager_emplyee_records')
      .insert({
        employee_id,
        work_date: date,
        clock_in: now,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, record: data });

  } catch (error) {
    console.error('출근 기록 오류:', error);
    return NextResponse.json(
      { success: false, error: '출근 기록 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
