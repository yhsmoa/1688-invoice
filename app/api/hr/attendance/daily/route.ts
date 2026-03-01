import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/hr/attendance/daily?date=YYYY-MM-DD
// 특정 날짜의 출근 기록 목록 조회 (직원 이름 포함)
// 두 단계 쿼리로 employee_id → name, name_kr 매핑
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json(
        { success: false, error: '날짜 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. 해당 날짜 출근 기록 조회 ─────────────────────────
    const { data: records, error: recordsError } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id, employee_id, work_date, clock_in, clock_out, total_minutes')
      .eq('work_date', date)
      .not('clock_in', 'is', null)
      .order('clock_in', { ascending: true });

    if (recordsError) throw recordsError;
    if (!records || records.length === 0) {
      return NextResponse.json({ success: true, records: [] });
    }

    // ── 2. 직원 ID 리스트로 이름 일괄 조회 ──────────────────
    const employeeIds = [...new Set(records.map((r) => r.employee_id))];
    const { data: employees } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr')
      .in('id', employeeIds);

    const employeeMap = new Map((employees || []).map((e) => [e.id, e]));

    // ── 3. 기록 + 직원 정보 병합 ─────────────────────────────
    const enriched = records.map((record) => ({
      ...record,
      name: employeeMap.get(record.employee_id)?.name || null,
      name_kr: employeeMap.get(record.employee_id)?.name_kr || null,
    }));

    return NextResponse.json({ success: true, records: enriched });

  } catch (error) {
    console.error('일별 출근 기록 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '기록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
