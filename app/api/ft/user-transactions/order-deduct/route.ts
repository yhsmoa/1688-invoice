import { NextRequest, NextResponse } from 'next/server';
import { deductOrderFromExcel, LedgerError } from '../../../../../lib/userTransactions';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/user-transactions/order-deduct  (multipart: file, user_id)
//
// 1688 주문 내보내기 엑셀 → 신 원장 구매 차감.
//   · 파싱·계산 규칙은 auto-1688-order 와 동일 (lib/deductParser.ts)
//   · ft_orders 존재·단일·소유자 검증 후 deduct_balance_and_record_transaction_v2 호출
//     (원장 INSERT + ft_balances 캐시 + ft_orders 가격 4필드 = 한 트랜잭션)
//   · 같은 주문코드는 함수·부분 유니크 인덱스가 이중으로 막는다
//   · 파싱과 계산을 서버에서 하므로 화면이 보낸 금액을 그대로 믿지 않는다
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const userId = String(formData.get('user_id') ?? '');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '엑셀 파일이 없습니다.' }, { status: 400 });
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      return NextResponse.json({ success: false, error: '엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.' }, { status: 400 });
    }
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'user_id 는 UUID 형식이어야 합니다.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await deductOrderFromExcel(userId, buffer);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json(
        { success: false, error: error.message, committed: error.committed, transactionId: error.transactionId },
        { status: error.committed ? 500 : 400 },
      );
    }
    console.error('1688 주문 차감 오류:', error);
    return NextResponse.json(
      { success: false, error: '1688 주문 차감 중 오류가 발생했습니다.', details: error instanceof Error ? error.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
