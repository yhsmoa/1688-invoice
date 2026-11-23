import type { StorageProductInfo, WowWorkCard } from '../types';

// ============================================================
// 와우출고 모바일 작업 — 카드 만들기 (/api/ft/storage/wow/work 가 쓴다)
//
//   카드 = 저장된 선반 배정 한 줄 (ft_wow_finds: 박스 × 상품 × 선반). 화면에서 다시 계산하지 않는다
//     · 배정은 DB 함수 ft_wow_alloc 만 한다 (supabase/storage/011_wow_alloc.sql)
//       — 박스가 들어올 때 선반이 잡히고, 재고가 실제로 달라졌을 때만 다시 잡힌다
//     · found_qty null            할 일 — plan_qty 만큼 그 선반에서 꺼낸다
//       found_qty 있음 · 선반 있음   꺼냄 (plan_qty = found_qty, 0 이면 "여기엔 없음")
//       선반 없음                   잡을 재고가 없는 몫 (표시하면 부족 확인)
//   여기서 하는 일은 그 줄에 상품 정보 · 선반 코드 · 지금 재고 · 다른 선반을 붙이는 것뿐이다
// ============================================================

/** 그 상품의 선반 하나 (재고 > 0, 먼저 배치된 순으로 넘긴다) */
export interface WorkStockCell {
  location_id: string;
  location_code: string;
  qty: number;
}

/** 저장된 배정 한 줄 (ft_wow_finds) */
export interface WorkFind {
  product_id: string;
  location_id: string | null;
  plan_qty: number;
  found_qty: number | null;
  found_by: string | null;
  found_at: string | null;
  memo: string | null;
  memo_by: string | null;
  memo_at: string | null;
}

export interface WorkLine {
  product_id: string;
  qty: number;
  info: StorageProductInfo;
}

const cardKey = (productId: string, locationId: string | null) => `${productId}|${locationId ?? ''}`;

/** 카드에 같이 보여 주는 다른 선반 수 */
const MAX_SPARES = 3;

/** 선반 코드 순, 선반 없는 줄은 맨 뒤 */
const byLocation = (a: { code: string | null }, b: { code: string | null }) =>
  Number(a.code === null) - Number(b.code === null) || String(a.code).localeCompare(String(b.code));

export function buildWorkCards(
  lines: WorkLine[],
  cellsOf: (productId: string) => WorkStockCell[],
  finds: WorkFind[],
  /** 선반 코드 (다 꺼내 재고가 0 이 된 선반도 코드를 보여 준다) */
  locationCodeOf: (locationId: string) => string | null,
): WowWorkCard[] {
  const cards: WowWorkCard[] = [];

  for (const line of lines) {
    const cells = cellsOf(line.product_id);
    const cellById = new Map(cells.map((c) => [c.location_id, c]));

    // 표시 전인데 몫이 0 인 줄(메모만 남은 줄)은 카드가 아니다
    const rows = finds
      .filter((f) => f.product_id === line.product_id && (f.found_qty !== null || f.plan_qty > 0))
      .map((f) => ({ f, code: f.location_id ? cellById.get(f.location_id)?.location_code ?? locationCodeOf(f.location_id) : null }))
      .sort(byLocation);

    for (const { f, code } of rows) {
      cards.push({
        key: cardKey(line.product_id, f.location_id),
        product_id: line.product_id,
        location_id: f.location_id,
        location_code: code,
        plan_qty: f.plan_qty,
        stock_qty: (f.location_id ? cellById.get(f.location_id)?.qty : undefined) ?? 0,
        found_qty: f.found_qty,
        found_by: f.found_by,
        found_at: f.found_at,
        memo: f.memo,
        memo_by: f.memo_by,
        memo_at: f.memo_at,
        line_qty: line.qty,
        spares: cells
          .filter((c) => c.location_id !== f.location_id)
          .slice(0, MAX_SPARES)
          .map((c) => ({ location_code: c.location_code, qty: c.qty })),
        item_name: line.info.item_name,
        option_name: line.info.option_name,
        china_option1: line.info.china_option1,
        china_option2: line.info.china_option2,
        img_url: line.info.img_url,
        barcode: line.info.barcode,
        product_no: line.info.product_no,
      });
    }
  }
  return cards;
}

/** 카드 묶음의 진행 — 카드 수 · 꺼냈다고 표시한 선반 카드 · 부족으로 확인한 카드(선반 없는 카드) · 찾은 수량 합 */
export function workProgress(cards: WowWorkCard[]) {
  let found = 0;
  let short = 0;
  let foundQty = 0;
  for (const c of cards) {
    if (c.found_qty === null) continue;
    if (c.location_id === null) short += 1; else found += 1;
    foundQty += c.found_qty;
  }
  return { cards: cards.length, found_cards: found, short_cards: short, found_qty: foundQty };
}
