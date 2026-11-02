import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import type { StorageProductInfo } from '../../../storage/types';

// ============================================================
// /api/ft/storage/* 공용 — 조회 헬퍼 · 오류 문구
//
// 건수 (2026-11-02): ft_order_items 40,913 / ft_storage_* 신규 (0)
//   → 모든 조회는 id 100개 단위 in + range 페이지 루프 (1000행 제한 대응)
// ============================================================

const PAGE = 1000;
const ID_CHUNK = 100;

export const fail = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

export const serverError = (label: string, error: unknown) => {
  console.error(`${label}:`, error);
  return NextResponse.json(
    {
      success: false,
      error: `${label} 중 오류가 발생했습니다.`,
      details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
    },
    { status: 500 }
  );
};

// ============================================================
// rpc 오류 코드 → 사용자 문구 (supabase/storage/001_storage.sql)
// ============================================================
const STORAGE_ERROR_MESSAGE: Record<string, string> = {
  PUTAWAY_NOT_STOCK: '보관 상품의 입고 건이 아닙니다. (주문상태에서 보관 설정 확인)',
  PUTAWAY_INVALID_QTY: '배치 수량이 미배치 수량보다 많거나 올바르지 않습니다.',
  PUTAWAY_INVALID_LOCATION: '위치를 입력해 주세요.',
  PICK_ITEM_INVALID: '쉽먼트로 보낼 수 없는 상품입니다. (보관 해제 또는 완료된 주문)',
  PICK_BOX_NOT_OPEN: '박스가 이미 출고되었거나 다른 사용자의 박스입니다.',
  PICK_INVALID_QTY: '꺼낼 수량이 위치 재고보다 많거나 올바르지 않습니다.',
  MOVE_INVALID_LOCATION: '옮길 위치를 입력해 주세요.',
  MOVE_SAME_LOCATION: '같은 위치로는 옮길 수 없습니다.',
  MOVE_INVALID_QTY: '옮길 수량이 위치 재고보다 많거나 올바르지 않습니다.',
};

/** rpc 오류 → { code, message }. 박스 타입 불일치는 두 타입을 문구에 넣는다 */
export function toStorageError(raw: string | undefined): { code: string; message: string } {
  const text = raw ?? '';
  const mismatch = /PICK_BOX_TYPE_MISMATCH:([^:\s]*):([^:\s]*)/.exec(text);
  if (mismatch) {
    return {
      code: 'PICK_BOX_TYPE_MISMATCH',
      message: `박스 타입(${mismatch[1]})과 상품 타입(${mismatch[2]})이 다릅니다.`,
    };
  }
  const code = Object.keys(STORAGE_ERROR_MESSAGE).find((k) => text.includes(k));
  return code
    ? { code, message: STORAGE_ERROR_MESSAGE[code] }
    : { code: 'UNKNOWN', message: text || '알 수 없는 오류' };
}

// ============================================================
// 조회 헬퍼
// ============================================================

/** in 조건 + range 루프 — 키 100개 단위, 각 묶음은 1000행 단위로 끝까지 */
export async function fetchIn<T>(
  table: string,
  select: string,
  column: string,
  keys: string[],
  extraEq?: { column: string; value: string }
): Promise<T[]> {
  const all: T[] = [];
  const uniq = Array.from(new Set(keys.filter(Boolean)));
  for (let i = 0; i < uniq.length; i += ID_CHUNK) {
    const batch = uniq.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select(select).in(column, batch);
      if (extraEq) q = q.eq(extraEq.column, extraEq.value);
      const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return all;
}

/** eq 조건 전체 — range 루프 */
export async function fetchAllEq<T>(
  table: string,
  select: string,
  column: string,
  value: string,
  orderColumn = 'id'
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq(column, value)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** 집합 반환 rpc 도 PostgREST 1000행 제한을 받는다 → range 루프 */
export async function rpcAll<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

// ============================================================
// 상품 표시 정보 — product_id → 대표 주문 행
//   세트상품은 구성품이 여러 행 → set_seq(없으면 item_no) 가 가장 앞선 행을 대표로
// ============================================================
interface ItemRow {
  id: string;
  user_id: string;
  product_id: string | null;
  product_no: string | null;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  barcode: string | null;
  '1688_offer_id': string | null;
  shipment_type: string | null;
  coupang_shipment_size: string | null;
  set_total: number | null;
  set_seq: number | null;
  status: string | null;
}

const ITEM_SELECT =
  'id, user_id, product_id, product_no, item_no, item_name, option_name, china_option1, china_option2, ' +
  'img_url, barcode, 1688_offer_id, shipment_type, coupang_shipment_size, set_total, set_seq, status';

const toInfo = (r: ItemRow): StorageProductInfo => ({
  product_id: r.product_id ?? '',
  order_item_id: r.id,
  product_no: r.product_no,
  item_no: r.item_no,
  item_name: r.item_name,
  option_name: r.option_name,
  china_option1: r.china_option1,
  china_option2: r.china_option2,
  img_url: r.img_url,
  barcode: r.barcode,
  offer_id: r['1688_offer_id'],
  shipment_type: r.shipment_type,
  coupang_shipment_size: r.coupang_shipment_size,
  set_total: r.set_total,
  status: r.status,
});

const repOrder = (a: ItemRow, b: ItemRow) =>
  (a.set_seq ?? 0) - (b.set_seq ?? 0) || String(a.item_no ?? '').localeCompare(String(b.item_no ?? ''));

/** product_id 목록 → 대표 행 정보 (같은 사용자 행만) */
export async function fetchProductInfo(
  userId: string,
  productIds: string[]
): Promise<Map<string, StorageProductInfo>> {
  const rows = await fetchIn<ItemRow>('ft_order_items', ITEM_SELECT, 'product_id', productIds, {
    column: 'user_id',
    value: userId,
  });
  const byProduct = new Map<string, ItemRow[]>();
  for (const r of rows) {
    if (!r.product_id) continue;
    const arr = byProduct.get(r.product_id) ?? [];
    arr.push(r);
    byProduct.set(r.product_id, arr);
  }
  const out = new Map<string, StorageProductInfo>();
  for (const [pid, arr] of byProduct) out.set(pid, toInfo([...arr].sort(repOrder)[0]));
  return out;
}

/** 위치 id → 코드 */
export async function fetchLocationCodes(ids: string[]): Promise<Map<string, string>> {
  const rows = await fetchIn<{ id: string; code: string }>('ft_storage_locations', 'id, code', 'id', ids);
  return new Map(rows.map((r) => [r.id, r.code]));
}
