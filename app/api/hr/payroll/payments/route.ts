import { NextRequest, NextResponse } from 'next/server';
import {
  markPaid,
  normalizeRecordIds,
  PayrollPaymentError,
} from '../../../../../lib/payrollPayments';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/hr/payroll/payments — 급여 지급완료
//
//   Body: { record_ids: string[], paid_date: 'YYYY-MM-DD', note?: string }
//   선택한 출근기록(시간 셀)을 한 묶음으로 지급완료 처리한다.
//   검증(존재·퇴근 기록·같은 달·이미 지급·지급일 범위)과 기록은 DB 함수가 한 트랜잭션으로 한다.
//   지급 취소는 ./cancel
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
    }

    const recordIds = normalizeRecordIds(body.record_ids);
    const paidDate = String(body.paid_date ?? '');
    const note = typeof body.note === 'string' ? body.note : null;

    const result = await markPaid(recordIds, paidDate, note);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof PayrollPaymentError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('급여 지급완료 오류:', error);
    return NextResponse.json({ success: false, error: '급여 지급완료 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
