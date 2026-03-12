import { supabase } from './supabase';

// ============================================================
// ft_fulfillment_inbounds (inbound: ARRIVAL/CANCEL) +
// ft_fulfillment_outbounds (outbound: PACKED/SHIPMENT)
// 양 테이블 병렬 조회 후 병합하는 공통 헬퍼
// ============================================================

const INBOUND_TABLE  = 'ft_fulfillment_inbounds';
const OUTBOUND_TABLE = 'ft_fulfillment_outbounds';

// ── 단일 테이블 페이징 조회 (1000행 limit 우회) ──────────────
async function fetchPaged<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
  extraFilters?: { column: string; op: 'eq' | 'in'; value: unknown }[]
): Promise<T[]> {
  const BATCH = 100;
  const PAGE  = 1000;
  const all: T[] = [];

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let from = 0;

    while (true) {
      let query = supabase
        .from(table)
        .select(select)
        .in(column, batch)
        .range(from, from + PAGE - 1);

      if (extraFilters) {
        for (const f of extraFilters) {
          if (f.op === 'eq') query = query.eq(f.column, f.value);
          else if (f.op === 'in') query = query.in(f.column, f.value as string[]);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...(data as T[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  return all;
}

// ============================================================
// queryBothTables
//   양 테이블을 병렬 조회 후 합산 반환
//   - inbound (ft_fulfillment_inbounds): ARRIVAL, CANCEL
//   - outbound (ft_fulfillment_outbounds): PACKED, SHIPMENT
// ============================================================
export async function queryBothTables<T>(
  orderItemIds: string[],
  select: string,
  extraFilters?: { column: string; op: 'eq' | 'in'; value: unknown }[]
): Promise<T[]> {
  if (orderItemIds.length === 0) return [];

  const [inbound, outbound] = await Promise.all([
    fetchPaged<T>(INBOUND_TABLE,  select, 'order_item_id', orderItemIds, extraFilters),
    fetchPaged<T>(OUTBOUND_TABLE, select, 'order_item_id', orderItemIds, extraFilters),
  ]);

  return [...inbound, ...outbound];
}

// ============================================================
// findFulfillmentById
//   id로 inbound/outbound 테이블 탐색
//   반환: { table, row } 또는 null
// ============================================================
export async function findFulfillmentById<T>(
  id: string,
  select: string
): Promise<{ table: string; row: T } | null> {
  // inbound 먼저
  const { data: inRow, error: inErr } = await supabase
    .from(INBOUND_TABLE)
    .select(select)
    .eq('id', id)
    .single();

  if (!inErr && inRow) {
    return { table: INBOUND_TABLE, row: inRow as T };
  }

  // outbound
  const { data: outRow, error: outErr } = await supabase
    .from(OUTBOUND_TABLE)
    .select(select)
    .eq('id', id)
    .single();

  if (!outErr && outRow) {
    return { table: OUTBOUND_TABLE, row: outRow as T };
  }

  return null;
}

// ── 테이블명 export (다른 파일에서 직접 사용 시) ─────────────
export { INBOUND_TABLE, OUTBOUND_TABLE };
