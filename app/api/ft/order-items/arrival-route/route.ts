import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// PATCH /api/ft/order-items/arrival-route
//   입고 후 경로(보관) 변경 — SHIPMENT ↔ STOCK
//
//   Body: { user_id, item_id, arrival_route: 'SHIPMENT' | 'STOCK' }
//
//   · 상품(product_id) 단위로 바꾼다 — 세트 구성품(sibling)은 경로가 같아야 한다
//     (재고 원장 ft_storage_movements 가 product_id 단위). product_id 가 없으면 그 행만.
//   · STOCK → SHIPMENT 는 재고 위치에 남은 수량이 0 일 때만.
//     DB 트리거 ft_order_items_route_guard 가 막고(ROUTE_STOCK_REMAINING:n), 여기서 409 문구로 변환.
//     (고객 화면 purchase-agent 의 anon 직접 UPDATE 도 같은 트리거에 걸린다)
//   · 일반 PATCH /api/ft/order-items 는 arrival_route 를 받지 않는다 (sibling 불일치 방지)
// ============================================================

const ROUTES = new Set(['SHIPMENT', 'STOCK']);

export async function PATCH(request: NextRequest) {
  try {
    const { user_id, item_id, arrival_route } = await request.json();

    if (!user_id || !item_id || !ROUTES.has(arrival_route)) {
      return NextResponse.json(
        { success: false, error: 'user_id, item_id, arrival_route(SHIPMENT|STOCK) 가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 대상 행 → 같은 상품의 전체 행 ──
    const { data: item, error: itemErr } = await supabase
      .from('ft_order_items')
      .select('id, user_id, product_id')
      .eq('id', item_id)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item || item.user_id !== user_id) {
      return NextResponse.json({ success: false, error: '주문 행을 찾을 수 없습니다.' }, { status: 404 });
    }

    let query = supabase
      .from('ft_order_items')
      .update({ arrival_route })
      .eq('user_id', user_id);
    query = item.product_id ? query.eq('product_id', item.product_id) : query.eq('id', item.id);

    const { data: updated, error: updErr } = await query.select('id');
    if (updErr) {
      // ── 보관 해제 가드 (재고 잔량) ──
      const m = /ROUTE_STOCK_REMAINING:(\d+)/.exec(updErr.message ?? '');
      if (m) {
        return NextResponse.json(
          {
            success: false,
            error: `재고 위치에 ${m[1]}개가 남아 있어 보관을 해제할 수 없습니다. [재고]에서 쉽먼트로 보낸 뒤 다시 시도하세요.`,
          },
          { status: 409 }
        );
      }
      throw updErr;
    }

    return NextResponse.json({ success: true, ids: (updated ?? []).map((r) => r.id) });
  } catch (error) {
    console.error('arrival_route 변경 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '보관 설정 변경 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
