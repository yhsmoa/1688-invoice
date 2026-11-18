import { NextRequest, NextResponse } from 'next/server';
import { serverError, fetchAll, userFilter, fetchProductInfo, fetchLocationCodes } from '../storageShared';
import type { StockRow } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/stock[?user_id=]
//   [재고] — 상품 × 위치 잔량 (뷰 ft_storage_balance, qty ≠ 0). user_id 가 없으면 전체 사업자
//   음수 칸도 그대로 내려준다 (운영 이상 신호 — 화면에서 강조)
//   출고예정 · 잔여수량은 상품 합계 (뷰 ft_storage_available — 행마다 같은 값)
// ============================================================

interface BalanceRow {
  product_id: string;
  location_id: string;
  qty: number;
  first_putaway_at: string | null;
  last_moved_at: string | null;
}

interface AvailableRow { product_id: string; reserved: number; available: number }

export async function GET(request: NextRequest) {
  const filter = userFilter(request.nextUrl.searchParams.get('user_id'));

  try {
    const [balance, available] = await Promise.all([
      fetchAll<BalanceRow>('ft_storage_balance', 'product_id, location_id, qty, first_putaway_at, last_moved_at',
        ['user_id', 'product_id', 'location_id'], filter),
      fetchAll<AvailableRow>('ft_storage_available', 'product_id, reserved, available', ['user_id', 'product_id'], filter),
    ]);
    if (balance.length === 0) return NextResponse.json({ success: true, data: [] });

    const [info, codes] = await Promise.all([
      fetchProductInfo(balance.map((b) => b.product_id)),
      fetchLocationCodes(balance.map((b) => b.location_id)),
    ]);
    const availByProduct = new Map(available.map((a) => [a.product_id, a]));

    const data: StockRow[] = [];
    for (const b of balance) {
      const p = info.get(b.product_id);
      if (!p) continue;
      const a = availByProduct.get(b.product_id);
      data.push({
        ...p,
        location_id: b.location_id,
        location_code: codes.get(b.location_id) ?? '?',
        qty: b.qty,
        first_putaway_at: b.first_putaway_at,
        last_moved_at: b.last_moved_at,
        reserved: a?.reserved ?? 0,
        available: a?.available ?? 0,
      });
    }
    data.sort((a, b) => a.location_code.localeCompare(b.location_code) || String(a.product_no).localeCompare(String(b.product_no)));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('재고 목록 조회', error);
  }
}
