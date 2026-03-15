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
//            - SUM(CANCEL quantity from ft_fulfillment_inbounds)
//            - SUM(PACKED quantity WHERE shipment_id IS NOT NULL from ft_fulfillment_outbounds)
// ============================================================
export async function confirmDoneForUser(
  userId: string
): Promise<{ updated: number; total: number }> {
  // ── 1) PROCESSING 상태 ft_order_items 조회 (product_id 포함) ──
  const items = await fetchAll<{ id: string; order_qty: number | null; product_id: string | null }>(
    'ft_order_items',
    'id, order_qty, product_id',
    [
      { column: 'user_id', op: 'eq', value: userId },
      { column: 'status', op: 'eq', value: 'PROCESSING' },
    ]
  );

  if (items.length === 0) {
    return { updated: 0, total: 0 };
  }

  const itemIds = items.map((i) => i.id);
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];

  // ── 2) 배치 조회: CANCEL(inbound) + SHIPMENT(outbound) ──
  const BATCH = 100;
  const cancelRows: { order_item_id: string; quantity: number; type: string }[] = [];
  const shipmentRows: { product_id: string | null; quantity: number; type: string; shipment_id: string | null }[] = [];

  // CANCEL은 ft_fulfillment_inbounds에서 order_item_id 기준 조회 (모든 CANCEL 취소수량)
  for (let i = 0; i < itemIds.length; i += BATCH) {
    const batch = itemIds.slice(i, i + BATCH);

    const { data, error } = await supabase
      .from('ft_fulfillment_inbounds')
      .select('order_item_id, quantity, type')
      .in('order_item_id', batch)
      .eq('type', 'CANCEL');

    if (error) throw error;
    if (data) cancelRows.push(...data);
  }

  // SHIPMENT은 ft_fulfillment_outbounds에서 product_id 기준 조회 (shipment_id 있는 PACKED만)
  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH);

    const { data, error } = await supabase
      .from('ft_fulfillment_outbounds')
      .select('product_id, quantity, type, shipment_id')
      .in('product_id', batch)
      .eq('type', 'PACKED');

    if (error) throw error;
    if (data) shipmentRows.push(...data);
  }

  // ── 3) 집계: CANCEL(전부) + SHIPMENT(shipment_id 있는 것만) ──
  const cancelMap = new Map<string, number>();
  const shipmentByProductMap = new Map<string | null, number>();

  // CANCEL 집계 (item별 독립 처리, 모든 CANCEL 취소수량)
  for (const row of cancelRows) {
    cancelMap.set(row.order_item_id, (cancelMap.get(row.order_item_id) ?? 0) + row.quantity);
  }

  // SHIPMENT 집계 (product별로 합산, shipment_id 있는 PACKED만, 같은 product_id에 속한 모든 item이 동일한 shipmentQty 적용)
  for (const row of shipmentRows) {
    if (row.shipment_id != null) {
      shipmentByProductMap.set(row.product_id, (shipmentByProductMap.get(row.product_id) ?? 0) + row.quantity);
    }
  }

  // ── 4) 남은수량 <= 0인 항목 필터 ──
  const doneIds: string[] = [];

  for (const item of items) {
    const orderQty = item.order_qty ?? 0;
    const cancelQty = cancelMap.get(item.id) ?? 0;
    const shipmentQty = shipmentByProductMap.get(item.product_id) ?? 0;
    const remaining = orderQty - cancelQty - shipmentQty;

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

  // ── 1) 해당 shipment의 ft_fulfillment_outbounds에서 order_item_id 목록 추출 ──
  const ffRows: { order_item_id: string }[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('ft_fulfillment_outbounds')
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
