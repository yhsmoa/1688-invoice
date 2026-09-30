import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { fetchTradePnl, TradeError } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// GET /api/trade-account/pnl?unit=day|week|month&from&to
//   일/주/월별 손익 (rpc trade_pnl) — 최신 구간 먼저. 주는 월요일 시작
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('unit');
    const unit = raw === 'day' || raw === 'week' ? raw : 'month';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return NextResponse.json({ success: false, error: '날짜 형식은 YYYY-MM-DD 입니다.' }, { status: 400 });
    }
    const periods = await fetchTradePnl(unit, from, to);
    return NextResponse.json({ success: true, unit, periods });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('무역계좌 손익 조회 오류:', error);
    return NextResponse.json({ success: false, error: '손익 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
