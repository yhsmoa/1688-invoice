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
//   → total_minutes 계산: 실제 분 → 점심 공제(12-13시) → 30분 내림(floor)
// ============================================================

// ── KST 기준 분(0~1439) 반환 ──────────────────────────────────
function toKSTMinutes(date: Date): number {
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  return kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();
}

// ── 점심시간(12:00-13:00 KST) 공제 분 계산 ───────────────────
function calcLunchDeduction(clockIn: Date, clockOut: Date): number {
  const LUNCH_START = 12 * 60; // 720
  const LUNCH_END   = 13 * 60; // 780
  const inMin  = toKSTMinutes(clockIn);
  const outMin = toKSTMinutes(clockOut);
  const overlapStart = Math.max(inMin, LUNCH_START);
  const overlapEnd   = Math.min(outMin, LUNCH_END);
  return Math.max(0, overlapEnd - overlapStart);
}

// ── 순 근무 분 계산 (점심 공제 + 30분 내림) ──────────────────
function calcNetMinutes(clockIn: Date, clockOut: Date): number {
  const actualMinutes = Math.floor((clockOut.getTime() - clockIn.getTime()) / 60000);
  const lunchDeduction = calcLunchDeduction(clockIn, clockOut);
  const net = actualMinutes - lunchDeduction;
  return Math.max(0, Math.floor(net / 30) * 30);
}
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
      updatePayload = {
        clock_in:      clock_in_iso,
        clock_out:     clock_out_iso,
        // 점심 공제(12-13시) + 30분 내림 적용
        total_minutes: calcNetMinutes(clockIn, clockOut),
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
