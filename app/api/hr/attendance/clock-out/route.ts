import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/hr/attendance/clock-out
// 퇴근 기록 + total_minutes 자동 계산 저장
// Body: { record_id: string }
//
// total_minutes 계산 규칙:
//   1. 실제 근무 분 = clock_out - clock_in
//   2. 점심 공제: 근무 구간이 12:00-13:00(KST)와 겹치면 겹친 분 차감
//   3. 30분 단위 내림(floor) 적용
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

    // ── total_minutes 계산 (점심 공제 + 30분 단위 내림) ───────
    const totalMinutes = calcNetMinutes(clockIn, now);

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
