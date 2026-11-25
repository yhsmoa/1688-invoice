import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { SHIPMENT_WORK_MESSAGE } from '../../../../lib/shipmentWork';
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
// rpc 오류 코드 → 사용자 문구 (supabase/storage/001 ~ 010)
// ============================================================
const STORAGE_ERROR_MESSAGE: Record<string, string> = {
  PUTAWAY_NOT_STOCK: '보관 상품의 입고 건이 아닙니다. (주문상태에서 보관 설정 확인)',
  PUTAWAY_INVALID_QTY: '배치 수량이 미배치 수량보다 많거나 올바르지 않습니다.',
  PUTAWAY_INVALID_LOCATION: '위치를 입력해 주세요.',
  PICK_ITEM_INVALID: '쉽먼트로 보낼 수 없는 상품입니다. (보관 해제 또는 완료된 주문)',
  PICK_BOX_NOT_OPEN: '박스가 이미 출고되었거나 다른 사용자의 박스입니다.',
  PICK_INVALID_QTY: '꺼낼 수량이 위치 재고보다 많거나 올바르지 않습니다.',
  STOCK_TYPE_REQUIRED: '쉽먼트 타입(COUPANG / PERSONAL / DIRECT)을 정해 주세요.',
  STOCK_SIZE_REQUIRED: 'COUPANG 은 쿠팡 사이즈(Small / Medium / Large)가 필요합니다.',
  STOCK_PERSONAL_NO_REQUIRED: 'PERSONAL 은 개인 주문번호가 필요합니다.',
  STOCK_TYPE_LOCKED: '이미 다른 타입으로 담긴 미출고 박스가 있어 타입을 바꿀 수 없습니다. 출고 후 다시 시도하세요.',
  ADJUST_INVALID_QTY: '수량은 0 이상이어야 합니다.',
  ADJUST_NO_CHANGE: '현재 수량과 같습니다.',
  ADJUST_NOTE_REQUIRED: '사유를 입력해 주세요.',
  MOVE_INVALID_LOCATION: '옮길 위치를 입력해 주세요.',
  MOVE_SAME_LOCATION: '같은 위치로는 옮길 수 없습니다.',
  MOVE_INVALID_QTY: '옮길 수량이 위치 재고보다 많거나 올바르지 않습니다.',
  // ── 와우출고 (supabase/storage/005_wow.sql · 006_wow_stage.sql · 008_wow_ready.sql) ──
  PICK_BOX_WOW: '와우출고 박스에는 [쉽먼트]로 담을 수 없습니다.',
  PICK_OVER_AVAILABLE: '와우출고 출고예정 수량은 꺼낼 수 없습니다. 잔여수량까지만 꺼내 주세요.',
  WOW_BOX_LOCKED: '와우출고 박스는 와우출고 화면에서만 담고 뺄 수 있습니다.',
  WOW_BOX_NOT_FOUND: '와우출고 박스를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.',
  WOW_BOX_ALREADY_PICKED: '이미 작업완료한 박스입니다. 새로고침 후 확인하세요.',
  WOW_BOX_NOT_EMPTY: '상품을 담은 적 없는 미출고 X 박스만 고를 수 있습니다. (합배송 박스 제외)',
  WOW_BOX_NOT_PICKED: '아직 작업완료하지 않은 박스입니다. 새로고침 후 확인하세요.',
  WOW_BOX_SHIPPED: '이미 출고된 박스는 되돌릴 수 없습니다.',
  WOW_BOX_CANCELLED: '발주취소된 박스입니다. 새로고침 후 확인하세요.',
  // ── 쉽먼트 작업 중 (supabase/shipment/004_shipment_work.sql) — 재고 [쉽먼트] · 와우출고 출고준비 / 취소 / 발주취소 ──
  SHIPMENT_WORK_LOCKED: SHIPMENT_WORK_MESSAGE.SHIPMENT_WORK_LOCKED,
  WOW_PICK_OVER: '요청 수량보다 많이 담을 수 없습니다.',
  WOW_PICK_EMPTY: '하나도 꺼내지 못한 박스는 작업완료할 수 없습니다.',
  WOW_INVALID_INPUT: '요청이 바뀌었거나 올바르지 않습니다. 새로고침 후 다시 시도하세요.',
  WOW_WORK_ALREADY_STARTED: '이미 작업중인 박스입니다. 새로고침 후 확인하세요.',
  WOW_WORK_NOT_STARTED: '작업중인 박스가 아닙니다. 새로고침 후 확인하세요.',
  WOW_DOCS_NOT_READY: '마킹번호가 있고 부착문서 · 동봉문서가 모두 도착한 박스만 바로 출고준비할 수 있습니다. 새로고침 후 확인하세요.',
  WOW_READY_ALREADY: '이미 출고준비된 박스가 있습니다. 새로고침 후 확인하세요.',
  WOW_NOT_READY: '출고준비 단계가 아닌 박스가 있습니다. 새로고침 후 확인하세요.',
  WOW_BOX_READY: '출고준비된 박스입니다. [출고준비 취소] 후 작업완료를 취소해 주세요.',
  // ── 와우출고 모바일 작업 · 순서지정 · 합포장 (supabase/storage/010_wow_flow.sql) ──
  //   문구를 찾을 때 코드가 들어 있는지로 보므로, 다른 코드를 품은 긴 코드를 먼저 둔다 (WOW_FIND_OVER_STOCK › WOW_FIND_OVER)
  WOW_FIND_OVER_STOCK: '그 위치의 재고보다 많이 찾을 수 없습니다. 재고 수량을 먼저 확인해 주세요.',
  WOW_FIND_OVER: '그 선반에 잡아 둔 수량보다 많이 찾을 수 없습니다. 고치려면 [취소] 후 다시 표시해 주세요.',
  // ── 선반 배정 (supabase/storage/011_wow_alloc.sql) ──
  STOCK_RESERVED_WOW: '그 선반의 수량은 와우출고 박스에 잡혀 있습니다. 잡히지 않은 수량까지만 꺼낼 수 있습니다. (작업중인 박스가 찾았다고 표시한 수량은 줄일 수 없습니다)',
  WOW_FIND_INCOMPLETE: '아직 표시하지 않은 카드가 있습니다. 모든 카드를 [찾음] 또는 [부족] 으로 표시해 주세요.',
  WOW_BOX_SEQUENCED: '순서지정된 박스입니다. [초기화] 로 순서를 지운 뒤 작업완료를 취소해 주세요.',
  WOW_SEQ_NOT_READY: '서류준비 단계의 박스만 순서를 지정할 수 있습니다. 새로고침 후 확인하세요.',
  WOW_SEQ_NOT_SET: '순서지정 단계가 아닌 박스가 있습니다. 새로고침 후 확인하세요.',
  WOW_NOT_ATTACHED: '합포장을 이미 정했거나 부착완료 전인 박스가 있습니다. 새로고침 후 확인하세요.',
  WOW_PACK_NOT_ATTACHED: '부착완료한 박스 중 아직 합포장을 정하지 않은 박스만 고를 수 있습니다. 새로고침 후 확인하세요.',
  WOW_SIZE_LOCKED: '순서지정한 뒤에는 박스 크기를 바꿀 수 없습니다.',
  WOW_PACK_HAS_CARTON: '이미 마킹번호가 붙은 박스는 마대에 담을 수 없습니다. [그대로 출고] 로 처리해 주세요.',
  WOW_BAG_NOT_OPEN: '이미 출고준비된 마대이거나 없는 마대입니다. 새로고침 후 확인하세요.',
  WOW_BAG_PARTIAL: '마대는 통째로 출고준비해야 합니다. 그 마대의 박스를 모두 선택해 주세요.',
  WOW_NOT_PACKED: '마대 · 그대로 출고를 아직 정하지 않았거나 이미 출고준비된 박스가 있습니다. 새로고침 후 확인하세요.',
};

/** 와우 박스 보호 트리거(WOW_BOX_LOCKED) — 스캔 저장 · 포장 철회 · 박스 이동 라우트도 같은 문구 */
export const WOW_BOX_LOCKED_MESSAGE = STORAGE_ERROR_MESSAGE.WOW_BOX_LOCKED;

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
// 표기 헬퍼
// ============================================================

/** 전화번호에 하이픈 — 02-xxxx-xxxx · 0xx-xxx(x)-xxxx. 그 밖의 형식(대표번호 등)은 받은 그대로 */
export function formatPhone(raw: string): string {
  const m = /^(02|0\d{2})(\d{3,4})(\d{4})$/.exec(raw.replace(/\D/g, ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
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

/** 표 전체 (조건이 있으면 그 조건만) — range 루프. 뷰는 id 가 없어 정렬 열을 받는다 */
export async function fetchAll<T>(
  table: string,
  select: string,
  orderColumns: string[],
  filter?: { column: string; value: string }
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select);
    if (filter) q = q.eq(filter.column, filter.value);
    for (const c of orderColumns) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** ?user_id= 가 있으면 그 사업자만, 없으면 전체 (재고 화면은 한 번에 받아 사업자 탭으로 거른다) */
export const userFilter = (userId: string | null) => (userId ? { column: 'user_id', value: userId } : undefined);

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
  personal_order_no: string | null;
  set_total: number | null;
  set_seq: number | null;
  status: string | null;
}

const ITEM_SELECT =
  'id, user_id, product_id, product_no, item_no, item_name, option_name, china_option1, china_option2, ' +
  'img_url, barcode, 1688_offer_id, shipment_type, coupang_shipment_size, personal_order_no, set_total, set_seq, status';

const toInfo = (r: ItemRow): StorageProductInfo => ({
  product_id: r.product_id ?? '',
  user_id: r.user_id,
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
  personal_order_no: r.personal_order_no,
  set_total: r.set_total,
  status: r.status,
});

const repOrder = (a: ItemRow, b: ItemRow) =>
  (a.set_seq ?? 0) - (b.set_seq ?? 0) || String(a.item_no ?? '').localeCompare(String(b.item_no ?? ''));

/** product_id 목록 → 대표 행 정보 (product_id 는 한 사업자의 것이라 사용자 조건이 필요 없다) */
export async function fetchProductInfo(productIds: string[]): Promise<Map<string, StorageProductInfo>> {
  const rows = await fetchIn<ItemRow>('ft_order_items', ITEM_SELECT, 'product_id', productIds);
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
