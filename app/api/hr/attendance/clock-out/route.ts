import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/hr/attendance/clock-out
// 퇴근 기록 + total_minutes 자동 계산 저장
// Body: { record_id: string }
//
// total_minutes 계산 규칙:
//   - clock_out - clock_in = 실제 근무 분
//   - 30분 단위로 내림 (floor)
//   - 저장값: 실제 분(integer) → ex) 8h30m = 510, 8h45m = 510
//   - 표시: total_minutes / 60 → 8.5시간
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { record_id } = await request.json();

    if (!record_id) {
      return NextResponse.json(
        { success: false, error: '기록 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 기존 기록 조회 ───────────────────────────────────────
    const { data: existing, error: fetchError } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id, clock_in, clock_out')
      .eq('id', record_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { success: false, error: '출근 기록을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (existing.clock_out) {
      return NextResponse.json(
        { success: false, error: '이미 퇴근 처리된 기록입니다.' },
        { status: 409 }
      );
    }

    const now = new Date();
    const clockIn = new Date(existing.clock_in);

    // ── total_minutes 계산 (30분 단위 내림) ──────────────────
    const actualMinutes = Math.floor((now.getTime() - clockIn.getTime()) / 60000);
    const totalMinutes = Math.floor(actualMinutes / 30) * 30;

    // ── 퇴근 기록 업데이트 ───────────────────────────────────
    const { data, error } = await supabase
      .from('invoiceManager_emplyee_records')
      .update({
        clock_out: now.toISOString(),
        total_minutes: totalMinutes,
      })
      .eq('id', record_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, record: data });

  } catch (error) {
    console.error('퇴근 기록 오류:', error);
    return NextResponse.json(
      { success: false, error: '퇴근 기록 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
