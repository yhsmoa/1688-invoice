import { NextRequest, NextResponse } from 'next/server';
import { requireDbAccess } from '../../../../lib/dbAccess';
import { openTradeLedger, TradeError } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// POST /api/trade-account/open
//   Body: { bank_balance: number, balance_id: uuid }
//   이월 (1회) — 현재 통장잔고 + 미러링할 고객 그룹. rpc trade_open
// ============================================================
export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const bank = Number(body?.bank_balance);
    const balanceId = String(body?.balance_id ?? '');
    if (!Number.isFinite(bank)) throw new TradeError('통장잔고를 숫자로 입력해주세요.');
    if (!UUID_RE.test(balanceId)) throw new TradeError('고객 그룹(balance_id)이 올바르지 않습니다.');

    const result = await openTradeLedger(Math.round(bank * 100) / 100, balanceId, access.employeeId);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('무역계좌 이월 오류:', error);
    return NextResponse.json({ success: false, error: '이월 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
