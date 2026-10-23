import { NextRequest, NextResponse } from 'next/server';
import {
  cancelPaid,
  normalizeRecordIds,
  PayrollPaymentError,
} from '../../../../../../lib/payrollPayments';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/hr/payroll/payments/cancel — 급여 지급 취소
//
//   Body: { record_ids: string[] }
//   출근기록 단위로 지급완료를 취소한다. 기록은 지우지 않고 canceled_at 으로 이력을 남긴다.
//   취소한 시간은 다시 수정·삭제·지급완료할 수 있다.
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: '요청 본문이 올바르지 않습니다.' }, { status: 400 });
    }

    const recordIds = normalizeRecordIds(body.record_ids);
    const canceled = await cancelPaid(recordIds);
    return NextResponse.json({ success: true, canceled });
  } catch (error) {
    if (error instanceof PayrollPaymentError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('급여 지급 취소 오류:', error);
    return NextResponse.json({ success: false, error: '급여 지급 취소 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
