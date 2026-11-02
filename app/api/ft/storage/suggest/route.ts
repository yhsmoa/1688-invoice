import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, fetchProductInfo, fetchLocationCodes } from '../storageShared';
import type { LocationSuggestion } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/suggest?user_id=&product_id=
//   배치 모달의 추천 위치 칩
//     ① 같은 바코드 상품이 지금 보관된 위치 (이 상품 자신 포함 — 두 번째 입고 때 같은 칸)
//     ② 없으면 같은 1688 offer_id 상품이 보관된 위치
//     ③ 없으면 빈 배열
//   위치별 수량은 그 칸에 있는 해당 상품들의 합 (qty > 0 칸만)
// ============================================================

const PAGE = 1000;

interface BalanceRow { product_id: string; location_id: string; qty: number }

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const productId = request.nextUrl.searchParams.get('product_id');
  if (!userId || !productId) return fail('user_id, product_id 가 필요합니다.');

  try {
    // ── 이 사용자의 보관 중 칸 전체 ──
    const balance: BalanceRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_storage_balance')
        .select('product_id, location_id, qty')
        .eq('user_id', userId)
        .gt('qty', 0)
        .order('product_id', { ascending: true })
        .order('location_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      balance.push(...((data ?? []) as BalanceRow[]));
      if (!data || data.length < PAGE) break;
    }
    if (balance.length === 0) return NextResponse.json({ success: true, data: [] });

    const info = await fetchProductInfo(userId, [productId, ...balance.map((b) => b.product_id)]);
    const me = info.get(productId);
    if (!me) return NextResponse.json({ success: true, data: [] });

    // ── 규칙 순서대로 처음 걸리는 그룹 ──
    const group = (reason: LocationSuggestion['reason'], match: (pid: string) => boolean) => {
      const byLoc = new Map<string, number>();
      for (const b of balance) {
        if (match(b.product_id)) byLoc.set(b.location_id, (byLoc.get(b.location_id) ?? 0) + b.qty);
      }
      return { reason, byLoc };
    };
    const barcode = me.barcode?.trim();
    const offer = me.offer_id?.trim();
    const candidates = [
      barcode ? group('barcode', (pid) => pid === productId || info.get(pid)?.barcode?.trim() === barcode) : null,
      offer ? group('offer', (pid) => info.get(pid)?.offer_id?.trim() === offer) : null,
    ];
    const hit = candidates.find((c) => c !== null && c.byLoc.size > 0);
    if (!hit) return NextResponse.json({ success: true, data: [] });

    const codes = await fetchLocationCodes(Array.from(hit.byLoc.keys()));
    const data: LocationSuggestion[] = Array.from(hit.byLoc.entries())
      .map(([location_id, qty]) => ({
        location_id,
        location_code: codes.get(location_id) ?? '?',
        qty,
        reason: hit.reason,
      }))
      .sort((a, b) => b.qty - a.qty || a.location_code.localeCompare(b.location_code));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('추천 위치 조회', error);
  }
}
