import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// PUT /api/hr/attendance/update-time
//
// 출퇴근 시간 수정 + total_minutes 재계산
// Body: { record_id, clock_in_iso, clock_out_iso? }
//
// clock_out_iso가 null인 경우 (미퇴근 직원):
//   → clock_in만 업데이트, clock_out/total_minutes는 유지
// clock_out_iso가 있는 경우:
//   → 대소 비교 후 clock_in, clock_out, total_minutes 모두 업데이트
//   → total_minutes 계산: 실제 분 → 30분 단위 내림(floor)
// ============================================================
export async function PUT(request: NextRequest) {
  try {
    const { record_id, clock_in_iso, clock_out_iso } = await request.json();

    // ── 파라미터 검증 (clock_out_iso는 선택) ──────────────────
    if (!record_id || !clock_in_iso) {
      return NextResponse.json(
        { success: false, error: '필수 파라미터(record_id, clock_in_iso)가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const clockIn = new Date(clock_in_iso);
    if (isNaN(clockIn.getTime())) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 출근 시간 형식입니다.' },
        { status: 400 }
      );
    }

    // ── clock_out 유무에 따라 업데이트 페이로드 분기 ──────────
    // 미퇴근 직원(clock_out_iso = null)은 clock_in만 수정
    let updatePayload: Record<string, unknown> = { clock_in: clock_in_iso };

    if (clock_out_iso) {
      const clockOut = new Date(clock_out_iso);
      if (isNaN(clockOut.getTime())) {
        return NextResponse.json(
          { success: false, error: '유효하지 않은 퇴근 시간 형식입니다.' },
          { status: 400 }
        );
      }
      if (clockOut <= clockIn) {
        return NextResponse.json(
          { success: false, error: '퇴근 시간이 출근 시간보다 늦어야 합니다.' },
          { status: 400 }
        );
      }
      const actualMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000);
      updatePayload = {
        clock_in:      clock_in_iso,
        clock_out:     clock_out_iso,
        total_minutes: Math.floor(actualMinutes / 30) * 30,
      };
    }

    // ── 기록 업데이트 ─────────────────────────────────────────
    const { data, error } = await supabase
      .from('invoiceManager_emplyee_records')
      .update(updatePayload)
      .eq('id', record_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, record: data });

  } catch (error) {
    console.error('시간 수정 오류:', error);
    return NextResponse.json(
      { success: false, error: '시간 수정 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
