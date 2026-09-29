import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute, requireDbAccess } from '../../../../lib/dbAccess';
import { bankCheck, fetchBankChecks, TradeError } from '../../../../lib/tradeLedgerServer';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/trade-account/bank-check — 통장 대조 (매주)
//   GET  → 최근 대조 이력
//   POST { actual_bank, adjust, note } → 차이 기록 (+ adjust=true 면 '보정' 행으로 장부를 실제에 맞춤)
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const checks = await fetchBankChecks();
    return NextResponse.json({ success: true, checks });
  } catch (error) {
    console.error('통장 대조 이력 조회 오류:', error);
    return NextResponse.json({ success: false, error: '대조 이력 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request);
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const actual = Number(body?.actual_bank);
    if (!Number.isFinite(actual)) throw new TradeError('실제 통장잔고를 숫자로 입력해주세요.');
    const adjust = body?.adjust === true;
    const note = body?.note != null ? String(body.note).trim() || null : null;

    const result = await bankCheck(Math.round(actual * 100) / 100, adjust, note, access.employeeId);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof TradeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('통장 대조 오류:', error);
    return NextResponse.json({ success: false, error: '통장 대조 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
