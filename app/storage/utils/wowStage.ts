import type { StockRow, WowStage } from '../types';

// ============================================================
// 와우출고 단계 — 판정은 여기 한 곳 (API 가 줄마다 계산해 내려주고 화면은 그 값을 쓴다)
//   기록에서 읽어 낸다. 저장하는 단계 값은 없다 (supabase/storage/006_wow_stage.sql 머리말)
//
//   신규      담지 않았고 작업 시작 기록 없음
//   작업중    담지 않았고 작업 시작 기록 있음           — [작업]
//   작업완료  담았고 서류 2종이 아직 다 오지 않음        — [작업완료]
//   서류준비  담았고 부착문서 · 동봉문서가 둘 다 도착     — 로켓이 올린다
//   출고      묶인 1688 박스의 포장 행이 전부 출고됨     — 쉽먼트 V2 에서 출고하면 자동
// ============================================================

/** 탭 순서 = 진행 순서 */
export const WOW_STAGES: readonly WowStage[] = ['new', 'working', 'done', 'docs', 'shipped'];

/** 출고한 박스를 [출고] 탭에 남겨 두는 기간 (일) — 지나면 목록에서 빠진다 */
export const WOW_SHIPPED_VISIBLE_DAYS = 7;

export interface WowStageInput {
  box_info_id: string | null;
  work_started_at: string | null;
  label_path: string | null;
  manifest_path: string | null;
  shipped: boolean;
}

export function wowStageOf(b: WowStageInput): WowStage {
  if (b.shipped) return 'shipped';
  if (b.box_info_id) return b.label_path && b.manifest_path ? 'docs' : 'done';
  return b.work_started_at ? 'working' : 'new';
}

// ============================================================
// 꺼낼 위치 — 표의 [위치] 칸과 [작업완료] 창의 기본 수량이 같은 계산을 쓴다
// ============================================================

/** 그 상품이 들어 있는 위치 (먼저 배치된 순) */
export function stockCellsOf(stockRows: StockRow[], productId: string): StockRow[] {
  return stockRows
    .filter((r) => r.product_id === productId && r.qty > 0)
    .sort((a, b) => String(a.first_putaway_at).localeCompare(String(b.first_putaway_at)));
}

export interface PickPlanCell {
  cell: StockRow;
  /** 이 위치에서 꺼낼 수량 (요청 수량을 앞 위치부터 채운 값) */
  take: number;
}

/** 요청 수량을 먼저 배치된 위치부터 채운다. short = 재고가 모자라 채우지 못한 수량 */
export function planPicks(qty: number, cells: StockRow[]): { plan: PickPlanCell[]; short: number } {
  let left = qty;
  const plan = cells.map((cell) => {
    const take = Math.min(cell.qty, left);
    left -= take;
    return { cell, take };
  });
  return { plan, short: left };
}
