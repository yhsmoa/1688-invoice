import type { StockRow, WowStage } from '../types';

// ============================================================
// 와우출고 단계 — 판정은 여기 한 곳 (API 가 줄마다 계산해 내려주고 화면은 그 값을 쓴다)
//   기록에서 읽어 낸다. 저장하는 단계 값은 없다 (supabase/storage/010_wow_flow.sql 머리말)
//
//   신규      작업 시작 기록 없음                        — PC [라벨출력] 으로 박스 라벨을 뽑는다
//   작업중    작업 시작 기록 있음, 아직 담지 않음           — 모바일(/m/wow)에서 박스 라벨을 찍으면 시작
//   작업완료  담았고(picked_at) 서류 2종이 아직 다 오지 않음 — 모바일 [작업완료]
//   서류준비  담았고 부착문서 · 동봉문서가 둘 다 도착        — 로켓이 올린다. [순서지정] 대상
//   순서지정  실을 순서가 정해짐(ship_seq)                 — 그 순서로 서류 · 택배엑셀을 뽑아 붙인다 → [부착완료]
//   합포장    서류를 다 붙임(attached_at)                  — 마대에 담거나 그대로 출고로 정한 뒤(packed_at) [출고준비완료]
//   출고준비  출고준비 기록 있음(ready_at)                 — 마킹번호가 붙는다. 쉽먼트 V2 출고 대기 목록에 보인다
//   출고      포장 행이 전부 출고됨                        — 쉽먼트 V2 에서 출고하면 자동
//   (2026-11-24 까지 담은 박스는 순서지정 · 합포장 없이 바로 출고준비가 된 것도 있다 — ready_at 이 먼저다)
// ============================================================

/** 탭 순서 = 진행 순서 */
export const WOW_STAGES: readonly WowStage[] = ['new', 'working', 'done', 'docs', 'seq', 'pack', 'ready', 'shipped'];

/** 출고한 박스를 [출고] 탭에 남겨 두는 기간 (일) — 지나면 목록에서 빠진다 */
export const WOW_SHIPPED_VISIBLE_DAYS = 7;

export interface WowStageInput {
  /** [작업완료] 시각 (박스) */
  box_picked_at: string | null;
  work_started_at: string | null;
  label_path: string | null;
  manifest_path: string | null;
  ship_seq: number | null;
  /** [부착완료] 시각 */
  attached_at: string | null;
  ready_at: string | null;
  shipped: boolean;
}

/** 쉽먼트 V2 에서 출고할 수 있는가 — [출고준비] 박스만 (대기 목록 · 출고 API 가 같은 조건을 쓴다) */
export const wowShippable = (b: Pick<WowStageInput, 'ready_at'>): boolean => !!b.ready_at;

export function wowStageOf(b: WowStageInput): WowStage {
  if (b.shipped) return 'shipped';
  if (wowShippable(b)) return 'ready';
  if (b.box_picked_at) {
    if (b.attached_at) return 'pack';
    if (b.ship_seq != null) return 'seq';
    return b.label_path && b.manifest_path ? 'docs' : 'done';
  }
  return b.work_started_at ? 'working' : 'new';
}

/** 박스 크기 — 로켓(immongRK_scan)의 BOX_SIZES 와 같은 목록 · 같은 순서 (모바일 [박스 크기 변경]) */
export const WOW_BOX_SIZES: readonly string[] = ['극소', '소', '중', '대', '대2'];

/** 담은 뒤의 단계 (담은 수량 · 담당을 보여 준다) */
export const WOW_PICKED_STAGES: readonly WowStage[] = ['done', 'docs', 'seq', 'pack', 'ready', 'shipped'];

// ============================================================
// 꺼낼 위치 — 표의 [위치] 칸과 모바일 카드가 같은 계산을 쓴다
// ============================================================

/** 그 상품이 들어 있는 위치 (먼저 배치된 순) */
export function stockCellsOf(stockRows: StockRow[], productId: string): StockRow[] {
  return stockRows
    .filter((r) => r.product_id === productId && r.qty > 0)
    .sort((a, b) => String(a.first_putaway_at).localeCompare(String(b.first_putaway_at)));
}

export interface PickPlanCell<T extends { qty: number }> {
  cell: T;
  /** 이 위치에서 꺼낼 수량 (요청 수량을 앞 위치부터 채운 값) */
  take: number;
}

/** 요청 수량을 먼저 배치된 위치부터 채운다. short = 재고가 모자라 채우지 못한 수량 */
export function planPicks<T extends { qty: number }>(qty: number, cells: T[]): { plan: PickPlanCell<T>[]; short: number } {
  let left = Math.max(qty, 0);
  const plan = cells.map((cell) => {
    const take = Math.min(cell.qty, left);
    left -= take;
    return { cell, take };
  });
  return { plan, short: left };
}
