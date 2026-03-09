import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// Supabase 기본 limit(1000) 우회 — 전체 데이터 페이징 조회
// ============================================================
async function fetchAll<T>(
  table: string,
  select: string,
  filters: { column: string; op: 'eq' | 'in'; value: unknown }[]
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select).range(from, from + PAGE - 1);
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.column, f.value);
      else if (f.op === 'in') query = query.in(f.column, f.value as string[]);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ============================================================
// POST /api/ft/confirm-done
// PROCESSING 상태인 ft_order_items 중
// order_qty - CANCEL수량 - 출고완료PACKED수량 = 0 인 항목을 DONE으로 변경
//
// Body: { user_id: string }
//
// 계산식:
//   남은수량 = order_qty
//            - SUM(ft_fulfillments.quantity WHERE type='CANCEL')
//            - SUM(ft_fulfillments.quantity WHERE type='PACKED' AND shipment_id IS NOT NULL)
//   남은수량 == 0 → status = 'DONE'
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1) PROCESSING 상태 ft_order_items 조회 (limit 해제) ──
    const items = await fetchAll<{ id: string; order_qty: number | null }>(
      'ft_order_items',
      'id, order_qty',
      [
        { column: 'user_id', op: 'eq', value: user_id },
        { column: 'status', op: 'eq', value: 'PROCESSING' },
      ]
    );

    if (items.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: 'PROCESSING 항목이 없습니다.' });
    }

    const itemIds = items.map((i) => i.id);

    // ── 2) ft_fulfillments 일괄 조회 (CANCEL + PACKED with shipment_id) ──
    //    100개씩 배치 처리
    const BATCH = 100;
    const ffRows: { order_item_id: string; quantity: number; type: string; shipment_id: string | null }[] = [];

    for (let i = 0; i < itemIds.length; i += BATCH) {
      const batch = itemIds.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('ft_fulfillments')
        .select('order_item_id, quantity, type, shipment_id')
        .in('order_item_id', batch)
        .in('type', ['CANCEL', 'PACKED']);

      if (error) throw error;
      if (data) ffRows.push(...data);
    }

    // ── 3) order_item_id별 집계 ──
    const cancelMap = new Map<string, number>();   // CANCEL 수량 합계
    const shippedMap = new Map<string, number>();   // PACKED + shipment_id IS NOT NULL 수량 합계

    for (const ff of ffRows) {
      if (ff.type === 'CANCEL') {
        cancelMap.set(ff.order_item_id, (cancelMap.get(ff.order_item_id) ?? 0) + ff.quantity);
      } else if (ff.type === 'PACKED' && ff.shipment_id != null) {
        shippedMap.set(ff.order_item_id, (shippedMap.get(ff.order_item_id) ?? 0) + ff.quantity);
      }
    }

    // ── 4) 남은수량 == 0인 항목 필터 ──
    const doneIds: string[] = [];

    for (const item of items) {
      const orderQty = item.order_qty ?? 0;
      const cancelQty = cancelMap.get(item.id) ?? 0;
      const shippedQty = shippedMap.get(item.id) ?? 0;
      const remaining = orderQty - cancelQty - shippedQty;

      if (remaining <= 0) {
        doneIds.push(item.id);
      }
    }

    if (doneIds.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: '확정할 항목이 없습니다.' });
    }

    // ── 5) ft_order_items.status = 'DONE' 일괄 업데이트 ──
    let updateCount = 0;
    for (let i = 0; i < doneIds.length; i += BATCH) {
      const batch = doneIds.slice(i, i + BATCH);
      const { error } = await supabase
        .from('ft_order_items')
        .update({ status: 'DONE' })
        .in('id', batch);

      if (error) throw error;
      updateCount += batch.length;
    }

    console.log(`confirm-done: ${updateCount}/${items.length}개 항목 DONE 처리`);

    return NextResponse.json({
      success: true,
      updated: updateCount,
      total: items.length,
      message: `${updateCount}개 항목이 DONE 처리되었습니다.`,
    });
  } catch (error) {
    console.error('confirm-done 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확정 처리 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
