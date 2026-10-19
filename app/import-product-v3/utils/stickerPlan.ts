import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { compareText, setInstanceKeyOf } from './groupKeys';

// ============================================================
// 상품입고 V3 — 라벨 출력 계획 (순수 함수)
//
// ── 라벨 스티커(barcode) ──
//   단품 : 배분 수량 그대로
//   세트 : 세트 1벌(product_id) 당 1장. 어느 구성품이 먼저 오든 "처음 도착할 때
//          도착 수량만큼" 뽑고, 나중 구성품은 이미 뽑힌 만큼 건너뛴다.
//
//     cap(S)     = min_p (order_qty_p − CANCEL_p)          만들 수 있는 최대 세트 수
//     arrived(p) = ARRIVAL_p(DB) + (저장 전이면 이번 배분_p)
//     target(S)  = min(cap, max_p arrived(p))              지금까지 필요한 누적 장수
//     printed(S) = Σ_p label_print_logs(barcode).qty        (형제 행 전체 합 — 대표 행에만 기록되므로)
//     toPrint(S) = max(0, target − printed)                 (작업자가 직접 지정하면 그 값)
//
//   max 를 쓰는 이유: "먼저 온 구성품 수량만큼 바로 출력" 이 운영 요구. min(완성 세트 수)이면
//   화이트만 왔을 때 0장이 된다. cap 으로 자르는 이유: 다른 구성품이 취소된 세트는 팔 수 없다.
//
// ── 케어 라벨(care) ──
//   구성품(행)마다 자기 배분 수량 — 세트도 병합하지 않는다 (화이트 10 + 블랙 10 = 20장)
//
// 바코드 없는 행은 두 라벨 모두 제외 (V2 와 동일).
// ============================================================

/** 계산에 쓰는 최소 컬럼 — 검증 스크립트에서 가짜 행으로 돌릴 수 있게 */
export type StickerRow = Pick<
  FtOrderItem,
  'id' | 'product_id' | 'product_no' | 'set_total' | 'set_seq' | 'order_qty' | 'barcode' | 'item_no'
>;

export interface StickerPlanInput<T extends StickerRow> {
  /** 행 id → 이번 배분 수량 */
  alloc: Map<string, number>;
  /** 배분된 행 조회용 */
  rowsById: Map<string, T>;
  /** product_id → 세트 구성품 전체 (검색 결과에 없는 형제 행 포함) */
  partsByProductId: Map<string, T[]>;
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  /** order_item_id → label_print_logs(label_type='barcode') qty 합 */
  printedBarcodeByItem: Map<string, number>;
  /** true = 배분이 아직 저장 전 (DB ARRIVAL 에 없으므로 더해서 계산) */
  includePending: boolean;
  /** product_id → 작업자가 직접 지정한 장수 */
  overrides?: Map<string, number>;
}

export interface SetStickerLine<T extends StickerRow> {
  productId: string;
  productNo: string | null;
  cap: number;
  target: number;
  printed: number;
  /** 자동 계산값 */
  auto: number;
  /** 실제 출력할 장수 (직접 지정 반영) */
  toPrint: number;
  overridden: boolean;
  /** 출력·기록에 쓰는 대표 행 (이번 배분 중 set_seq 최소) */
  rep: T;
}

export interface StickerPlan<T extends StickerRow> {
  /** printLabels 에 넘길 행 — 단품 행 + 세트 대표 행 */
  rows: { item: T; qty: number }[];
  sets: SetStickerLine<T>[];
  /** 세트 중복 제외로 줄어든 장수 (세트 행 배분 합 − 세트 출력 합) */
  skippedSheets: number;
  totalSheets: number;
}

// ============================================================
// 라벨 스티커
// ============================================================
export function planStickers<T extends StickerRow>(input: StickerPlanInput<T>): StickerPlan<T> {
  const { alloc, rowsById, partsByProductId, arrivalMap, cancelMap, printedBarcodeByItem, includePending, overrides } =
    input;

  const rows: { item: T; qty: number }[] = [];
  const setAllocRows = new Map<string, T[]>();
  let setAllocSheets = 0;

  // ── 1) 단품은 그대로, 세트는 product_id 별로 모은다 ──
  for (const [id, qty] of alloc) {
    if (qty <= 0) continue;
    const item = rowsById.get(id);
    if (!item || !item.barcode) continue;
    const setKey = setInstanceKeyOf(item);
    if (!setKey) {
      rows.push({ item, qty });
      continue;
    }
    const list = setAllocRows.get(setKey) ?? [];
    list.push(item);
    setAllocRows.set(setKey, list);
    setAllocSheets += qty;
  }

  // ── 2) 세트별 계산 ──
  const sets: SetStickerLine<T>[] = [];
  for (const [productId, allocRows] of setAllocRows) {
    // 구성품 = 형제 전체 ∪ 이번 배분 행 (형제 조회가 비었어도 계산이 무너지지 않게)
    const partMap = new Map<string, T>();
    for (const p of partsByProductId.get(productId) ?? []) partMap.set(p.id, p);
    for (const r of allocRows) partMap.set(r.id, r);
    const parts = Array.from(partMap.values());

    const cap = Math.max(0, Math.min(...parts.map((p) => (p.order_qty ?? 0) - (cancelMap.get(p.id) ?? 0))));
    const maxArrived = Math.max(
      ...parts.map((p) => (arrivalMap.get(p.id) ?? 0) + (includePending ? alloc.get(p.id) ?? 0 : 0))
    );
    const target = Math.min(cap, maxArrived);
    const printed = parts.reduce((n, p) => n + (printedBarcodeByItem.get(p.id) ?? 0), 0);
    const auto = Math.max(0, target - printed);
    const overridden = overrides?.has(productId) ?? false;
    const toPrint = overridden ? Math.max(0, Math.floor(overrides!.get(productId)!)) : auto;

    const rep = [...allocRows].sort(
      (a, b) => (a.set_seq ?? Infinity) - (b.set_seq ?? Infinity) || compareText(a.item_no, b.item_no)
    )[0];

    sets.push({ productId, productNo: rep.product_no, cap, target, printed, auto, toPrint, overridden, rep });
    if (toPrint > 0) rows.push({ item: rep, qty: toPrint });
  }

  const setPrinted = sets.reduce((n, s) => n + s.toPrint, 0);
  return {
    rows,
    sets,
    skippedSheets: Math.max(0, setAllocSheets - setPrinted),
    totalSheets: rows.reduce((n, r) => n + r.qty, 0),
  };
}

// ============================================================
// 케어 라벨 — 배분된 바코드 행 그대로 (세트 병합 없음)
// ============================================================
export function planCareLabels<T extends Pick<FtOrderItem, 'id' | 'barcode'>>(
  alloc: Map<string, number>,
  rowsById: Map<string, T>
): { item: T; qty: number }[] {
  const out: { item: T; qty: number }[] = [];
  for (const [id, qty] of alloc) {
    if (qty <= 0) continue;
    const item = rowsById.get(id);
    if (item && item.barcode) out.push({ item, qty });
  }
  return out;
}
