import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { fetchTradeRows } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================
// GET /api/trade-account/ledger?from=YYYY-MM-DD&to=YYYY-MM-DD
//   적용일 구간의 원장 행 (체인 순서). 잔고 세 열은 DB 스냅샷 그대로.
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return NextResponse.json({ success: false, error: '날짜 형식은 YYYY-MM-DD 입니다.' }, { status: 400 });
    }
    const rows = await fetchTradeRows(from, to);
    return NextResponse.json({ success: true, rows });
  } catch (error) {
    console.error('무역계좌 원장 조회 오류:', error);
    return NextResponse.json({ success: false, error: '무역계좌 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
