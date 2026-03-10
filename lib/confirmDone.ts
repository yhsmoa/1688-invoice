import { supabase } from './supabase';

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
// confirmDoneForUser
//   PROCESSING ft_order_items 중 남은수량 <= 0인 항목을 DONE으로 전환
//
//   남은수량 = order_qty
//            - SUM(CANCEL quantity)
//            - SUM(PACKED quantity WHERE shipment_id IS NOT NULL)
// ============================================================
export async function confirmDoneForUser(
  userId: string
): Promise<{ updated: number; total: number }> {
  // ── 1) PROCESSING 상태 ft_order_items 조회 ──
  const items = await fetchAll<{ id: string; order_qty: number | null }>(
    'ft_order_items',
    'id, order_qty',
    [
      { column: 'user_id', op: 'eq', value: userId },
      { column: 'status', op: 'eq', value: 'PROCESSING' },
    ]
  );

  if (items.length === 0) {
    return { updated: 0, total: 0 };
  }

  const itemIds = items.map((i) => i.id);

  // ── 2) ft_fulfillments 배치 조회 (CANCEL + PACKED) ──
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
  const cancelMap = new Map<string, number>();
  const shippedMap = new Map<string, number>();

  for (const ff of ffRows) {
    if (ff.type === 'CANCEL') {
      cancelMap.set(ff.order_item_id, (cancelMap.get(ff.order_item_id) ?? 0) + ff.quantity);
    } else if (ff.type === 'PACKED' && ff.shipment_id != null) {
      shippedMap.set(ff.order_item_id, (shippedMap.get(ff.order_item_id) ?? 0) + ff.quantity);
    }
  }

  // ── 4) 남은수량 <= 0인 항목 필터 ──
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
    return { updated: 0, total: items.length };
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

  console.log(`confirmDoneForUser: ${updateCount}/${items.length}개 항목 DONE 처리`);

  return { updated: updateCount, total: items.length };
}

// ============================================================
// revertDoneForShipment
//   특정 shipment에 연결된 ft_order_items DONE → PROCESSING 복귀
//   이후 confirmDoneForUser 재실행하여 다른 쉽먼트로 인한 DONE 유지
// ============================================================
export async function revertDoneForShipment(
  shipmentId: string,
  userId: string
): Promise<{ reverted: number }> {
  const BATCH = 100;

  // ── 1) 해당 shipment의 ft_fulfillments에서 order_item_id 목록 추출 ──
  const ffRows: { order_item_id: string }[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('ft_fulfillments')
      .select('order_item_id')
      .eq('shipment_id', shipmentId)
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    ffRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const orderItemIds = [...new Set(ffRows.map((r) => r.order_item_id).filter(Boolean))];

  if (orderItemIds.length === 0) {
    return { reverted: 0 };
  }

  // ── 2) 해당 order_items 중 DONE → PROCESSING 복귀 ──
  let revertCount = 0;
  for (let i = 0; i < orderItemIds.length; i += BATCH) {
    const batch = orderItemIds.slice(i, i + BATCH);
    const { error } = await supabase
      .from('ft_order_items')
      .update({ status: 'PROCESSING' })
      .in('id', batch)
      .eq('status', 'DONE');

    if (error) throw error;
    revertCount += batch.length;
  }

  // ── 3) confirmDoneForUser 재실행 (다른 쉽먼트로 인한 DONE은 다시 DONE으로) ──
  await confirmDoneForUser(userId);

  console.log(`revertDoneForShipment: ${revertCount}개 항목 복귀 후 재계산 완료`);

  return { reverted: revertCount };
}
