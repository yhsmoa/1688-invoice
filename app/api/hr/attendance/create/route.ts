import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/hr/attendance/create
//
// 급여장부 빈 셀 클릭 → 출퇴근 기록 신규 생성
// Body: { employee_id, work_date, clock_in_iso, clock_out_iso }
//
// total_minutes 계산:
//   실제 분 → 점심 공제(12-13시 KST) → 30분 내림(floor)
// 중복 체크: 동일 employee_id + work_date 레코드 이미 있으면 409
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
    const { employee_id, work_date, clock_in_iso, clock_out_iso } = await request.json();

    // ── 필수 파라미터 검증 ─────────────────────────────────────
    if (!employee_id || !work_date || !clock_in_iso) {
      return NextResponse.json(
        { success: false, error: '필수 파라미터(employee_id, work_date, clock_in_iso)가 누락되었습니다.' },
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

    // ── 중복 레코드 체크 ──────────────────────────────────────
    const { data: existing } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id')
      .eq('employee_id', employee_id)
      .eq('work_date', work_date)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: '해당 날짜에 이미 출퇴근 기록이 존재합니다.' },
        { status: 409 }
      );
    }

    // ── total_minutes 계산 (퇴근 시간 있을 때만) ─────────────
    let total_minutes: number | null = null;

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
      total_minutes = calcNetMinutes(clockIn, clockOut);
    }

    // ── 레코드 삽입 ───────────────────────────────────────────
    const { data, error } = await supabase
      .from('invoiceManager_emplyee_records')
      .insert({
        employee_id,
        work_date,
        clock_in:      clock_in_iso,
        clock_out:     clock_out_iso ?? null,
        total_minutes,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, record: data });

  } catch (error) {
    console.error('출퇴근 기록 생성 오류:', error);
    return NextResponse.json(
      { success: false, error: '기록 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
