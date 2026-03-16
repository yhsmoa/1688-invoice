import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// GET /api/ft/order-items/filter-counts?user_id=X
// 미배송 / 지연배송 카운트 + id 목록 반환
//
// 미배송: 1688_order_id가 NULL이거나
//         1688_invoice_deliveryInfo_check에 해당 order_id가 없는 아이템
// 지연배송: created_at이 5일 이상 경과 AND
//          ft_fulfillment_inbounds에 type='ARRIVAL' 기록이 없는 아이템
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. PROCESSING 아이템 전체 조회 (페이징) ──
    const PAGE = 1000;
    const items: { id: string; '1688_order_id': string | null; created_at: string | null }[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('ft_order_items')
        .select('id, 1688_order_id, created_at')
        .eq('user_id', userId)
        .eq('status', 'PROCESSING')
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      items.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        no_delivery: { count: 0, ids: [] },
        delayed: { count: 0, ids: [] },
      });
    }

    // ── 2. 미배송 계산 ──
    // 1688_order_id가 있는 아이템들의 order_id 목록 수집
    const orderIdMap = new Map<string, string[]>(); // order_id → item_id[]
    const noOrderIdItems: string[] = []; // 1688_order_id가 NULL인 아이템

    for (const item of items) {
      const orderId = item['1688_order_id'];
      if (!orderId) {
        noOrderIdItems.push(item.id);
      } else {
        if (!orderIdMap.has(orderId)) {
          orderIdMap.set(orderId, []);
        }
        orderIdMap.get(orderId)!.push(item.id);
      }
    }

    // delivery_code 존재 여부 확인 (배치 조회)
    const uniqueOrderIds = [...orderIdMap.keys()];
    const hasDeliverySet = new Set<string>(); // delivery_code가 있는 order_id

    const BATCH = 100;
    for (let i = 0; i < uniqueOrderIds.length; i += BATCH) {
      const batch = uniqueOrderIds.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('order_id')
        .in('order_id', batch);

      if (error) throw error;
      for (const row of (data || [])) {
        hasDeliverySet.add(row.order_id);
      }
    }

    // 미배송 id 목록: order_id가 NULL + delivery_code가 없는 것
    const noDeliveryIds: string[] = [...noOrderIdItems];
    for (const [orderId, itemIds] of orderIdMap) {
      if (!hasDeliverySet.has(orderId)) {
        noDeliveryIds.push(...itemIds);
      }
    }

    // ── 3. 지연배송 계산 ──
    // created_at이 5일 이상 경과한 아이템
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const oldItems = items.filter((item) => {
      if (!item.created_at) return false;
      return new Date(item.created_at) <= fiveDaysAgo;
    });

    // 해당 아이템들의 ARRIVAL 기록 확인
    const oldItemIds = oldItems.map((item) => item.id);
    const hasArrivalSet = new Set<string>(); // ARRIVAL 기록이 있는 order_item_id

    for (let i = 0; i < oldItemIds.length; i += BATCH) {
      const batch = oldItemIds.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('ft_fulfillment_inbounds')
        .select('order_item_id')
        .in('order_item_id', batch)
        .eq('type', 'ARRIVAL');

      if (error) throw error;
      for (const row of (data || [])) {
        hasArrivalSet.add(row.order_item_id);
      }
    }

    // 지연배송: 5일 경과 + ARRIVAL 없는 것
    const delayedIds = oldItems
      .filter((item) => !hasArrivalSet.has(item.id))
      .map((item) => item.id);

    return NextResponse.json({
      success: true,
      no_delivery: { count: noDeliveryIds.length, ids: noDeliveryIds },
      delayed: { count: delayedIds.length, ids: delayedIds },
    });
  } catch (error) {
    console.error('filter-counts GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '필터 카운트 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
