import { NextRequest, NextResponse } from 'next/server';
import {
  fetchCustomerLedgerV2,
  recordManualTransaction,
  updateAppliedDate,
  LedgerError,
} from '../../../../lib/userTransactions';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/user-transactions — 고객계좌(신) · 신 원장 ft_user_transactions
//
//   GET   ?user_id=<ft_users.id>       원장 전체 + 잔액 (조회)
//   POST  { kind: 'charge'|'deduct', … } 충전 / 수동 차감 기록 (record_manual_transaction_v2)
//   PATCH { id, applied_date }          적용일 수정 (applied_date 만)
//
//   1688 주문 엑셀 차감은 ./order-deduct (multipart).
//   기록 로직·검증은 lib/userTransactions.ts. 구 원장은 읽지도 쓰지도 않는다.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** LedgerError → 응답. committed=true 면 원장에는 기록된 상태 (화면이 경고 후 새로고침) */
function ledgerErrorResponse(error: unknown, fallback: string) {
  if (error instanceof LedgerError) {
    return NextResponse.json(
      { success: false, error: error.message, committed: error.committed, transactionId: error.transactionId },
      { status: error.committed ? 500 : 400 },
    );
  }
  console.error(fallback, error);
  return NextResponse.json(
    { success: false, error: fallback, details: error instanceof Error ? error.message : '알 수 없는 오류' },
    { status: 500 },
  );
}

/** 숫자 필드 — 빈 값은 null, 그 외는 유한수여야 함 */
function numOrNull(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new LedgerError(`${label} 값이 숫자가 아닙니다.`);
  return n;
}

// ── GET: 조회 ──
export async function GET(request: NextRequest) {
  try {
    const userId = new URL(request.url).searchParams.get('user_id');
    if (!userId) return NextResponse.json({ success: false, error: 'user_id 파라미터가 필요합니다.' }, { status: 400 });
    if (!UUID_RE.test(userId)) return NextResponse.json({ success: false, error: 'user_id 는 UUID 형식이어야 합니다.' }, { status: 400 });

    const result = await fetchCustomerLedgerV2(userId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return ledgerErrorResponse(error, '고객계좌(신) 조회 중 오류가 발생했습니다.');
  }
}

// ── POST: 충전 / 수동 차감 ──
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const kind = body.kind as string;
    if (kind !== 'charge' && kind !== 'deduct') {
      return NextResponse.json({ success: false, error: "kind 는 'charge' 또는 'deduct' 여야 합니다." }, { status: 400 });
    }
    const userId = String(body.user_id ?? '');
    if (!UUID_RE.test(userId)) return NextResponse.json({ success: false, error: 'user_id 는 UUID 형식이어야 합니다.' }, { status: 400 });

    const amount = numOrNull(body.amount, '전체금액');
    if (amount == null) throw new LedgerError('전체금액을 입력해주세요.');

    const result = await recordManualTransaction({
      userId,
      type: kind === 'charge' ? 'in' : 'out',
      amount,
      appliedDate: String(body.applied_date ?? ''),
      description: String(body.description ?? ''),
      referenceId: String(body.reference_id ?? ''),
      adminNote: body.admin_note != null ? String(body.admin_note) : null,
      orderNo1688: body.order_no_1688 != null ? String(body.order_no_1688) : null,
      shippingFee: numOrNull(body.shipping_fee, '배송비'),
      serviceFee: numOrNull(body.service_fee, '서비스비'),
      otherFee: numOrNull(body.other_fee, '기타비용'),
      krwAmount: numOrNull(body.krw_amount, '원화 금액'),
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return ledgerErrorResponse(error, '기록 중 오류가 발생했습니다.');
  }
}

// ── PATCH: 적용일 수정 ──
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = String(body.id ?? '');
    const appliedDate = String(body.applied_date ?? '');
    if (!id) return NextResponse.json({ success: false, error: 'id 가 필요합니다.' }, { status: 400 });
    if (!appliedDate) return NextResponse.json({ success: false, error: 'applied_date 가 필요합니다.' }, { status: 400 });

    const data = await updateAppliedDate(id, appliedDate);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return ledgerErrorResponse(error, '적용일 수정 중 오류가 발생했습니다.');
  }
}
