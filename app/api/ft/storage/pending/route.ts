import { NextRequest, NextResponse } from 'next/server';
import { fail, serverError, rpcAll, fetchProductInfo } from '../storageShared';
import type { PendingRow } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/pending?user_id=
//   [작업중] — 보관 상품의 입고 줄 중 미배치 > 0
//
//   계산은 DB 함수 ft_storage_pending_lines 한 곳 (배치 검증과 같은 공식)
//   · 줄 = "완성 세트 수를 늘린 입고 건" (단품이면 입고 건 1건)
//   · 미배치는 오래된 줄부터 FIFO 소진
// ============================================================

interface LineRow {
  product_id: string;
  inbound_id: string;
  order_item_id: string;
  arrived_at: string;
  operator_name: string | null;
  line_qty: number;
  line_unplaced: number;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) return fail('user_id 가 필요합니다.');

  try {
    const lines = (await rpcAll<LineRow>('ft_storage_pending_lines', { p_user_id: userId }))
      .filter((l) => l.line_unplaced > 0);
    if (lines.length === 0) return NextResponse.json({ success: true, data: [] });

    const info = await fetchProductInfo(userId, lines.map((l) => l.product_id));

    const data: PendingRow[] = [];
    for (const l of lines) {
      const p = info.get(l.product_id);
      if (!p) continue;
      data.push({
        ...p,
        inbound_id: l.inbound_id,
        arrived_at: l.arrived_at,
        arrival_operator: l.operator_name,
        line_qty: l.line_qty,
        line_unplaced: l.line_unplaced,
      });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('작업중 목록 조회', error);
  }
}
