import { NextRequest, NextResponse } from 'next/server';
import { requireDbAccess } from '../../../../lib/dbAccess';
import { reverseTradeRow, TradeError } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// POST /api/trade-account/reverse
//   Body: { id: uuid, reason: string }
//   회사 행 취소 = 반대 방향 행 추가 (rpc trade_reverse). 삭제 없음.
// ============================================================
export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const id = String(body?.id ?? '');
    const reason = String(body?.reason ?? '').trim();
    if (!UUID_RE.test(id)) throw new TradeError('취소할 행 id 가 올바르지 않습니다.');
    if (!reason) throw new TradeError('취소 사유를 입력해주세요.');

    const reversalId = await reverseTradeRow(id, reason, access.employeeId);
    return NextResponse.json({ success: true, reversalId });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('무역계좌 취소 오류:', error);
    return NextResponse.json({ success: false, error: '취소 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
