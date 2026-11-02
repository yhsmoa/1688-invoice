import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, fetchProductInfo, fetchLocationCodes } from '../storageShared';
import type { StockRow } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/stock?user_id=
//   [재고] — 상품 × 위치 잔량 (뷰 ft_storage_balance, qty ≠ 0)
//   음수 칸도 그대로 내려준다 (운영 이상 신호 — 화면에서 강조)
// ============================================================

const PAGE = 1000;

interface BalanceRow {
  product_id: string;
  location_id: string;
  qty: number;
  first_putaway_at: string | null;
  last_moved_at: string | null;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) return fail('user_id 가 필요합니다.');

  try {
    // ── 잔량 (뷰에는 id 가 없어 product_id·location_id 로 정렬해 페이지) ──
    const balance: BalanceRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_storage_balance')
        .select('product_id, location_id, qty, first_putaway_at, last_moved_at')
        .eq('user_id', userId)
        .order('product_id', { ascending: true })
        .order('location_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      balance.push(...((data ?? []) as BalanceRow[]));
      if (!data || data.length < PAGE) break;
    }
    if (balance.length === 0) return NextResponse.json({ success: true, data: [] });

    const [info, codes] = await Promise.all([
      fetchProductInfo(userId, balance.map((b) => b.product_id)),
      fetchLocationCodes(balance.map((b) => b.location_id)),
    ]);

    const data: StockRow[] = [];
    for (const b of balance) {
      const p = info.get(b.product_id);
      if (!p) continue;
      data.push({
        ...p,
        location_id: b.location_id,
        location_code: codes.get(b.location_id) ?? '?',
        qty: b.qty,
        first_putaway_at: b.first_putaway_at,
        last_moved_at: b.last_moved_at,
      });
    }
    data.sort((a, b) => a.location_code.localeCompare(b.location_code) || String(a.product_no).localeCompare(String(b.product_no)));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('재고 목록 조회', error);
  }
}
