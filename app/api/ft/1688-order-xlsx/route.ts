import { NextRequest, NextResponse } from 'next/server';
import { lookupOrderXlsx } from '../../../../lib/orderXlsxLookup';

// ============================================================
// POST /api/ft/1688-order-xlsx
//
// 1688 주문번호 → [1688 XLSX](1688_invoice_deliveryInfo_check) 에 담긴 주문 정보
//   · accounts : 그 주문이 들어 있는 1688 계정 (buyer_account) + 배지 글자 (N / Y)
//   · statuses : 1688 주문상태 (엑셀 J열 订单状态 — 交易关闭 · 退款中 등)
// 주문상태 V2 의 계정 배지 · [주문누락?] 판정용
//
// Request:  { order_ids: string[] }
// Response: {
//   success: true,
//   data: {
//     [1688_order_id]: {
//       accounts: [{ account: string, badge: string }],
//       statuses: string[],
//     }
//   }
// }
//
// 조회 규칙(청크 500 · 1000행 페이지 · 정렬 · 배지)은 lib/orderXlsxLookup 에 있다.
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_ids } = body as { order_ids: unknown };

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    const data = await lookupOrderXlsx(order_ids);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('1688-order-xlsx 조회 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: '1688 주문 엑셀 정보 조회 중 오류', details: message },
      { status: 500 }
    );
  }
}
