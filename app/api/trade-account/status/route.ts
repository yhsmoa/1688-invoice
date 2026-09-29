import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { fetchTradeStatus } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/trade-account/status
//   이월 여부 · 미러링 그룹 · 마지막 스냅샷(통장/충전금/자산) · 정합 근거
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const status = await fetchTradeStatus();
    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('무역계좌 상태 조회 오류:', error);
    return NextResponse.json({ success: false, error: '무역계좌 상태 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
