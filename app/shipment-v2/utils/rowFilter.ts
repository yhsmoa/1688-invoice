// ============================================================
// 쉽먼트 V2 — 필터 (두 축을 AND 로 결합)
//
//   ① 보드 필터 (상단 카드)  : [전체] [A] [B] [C] [P] [X] [요청]
//        · type     — 행이 담긴 박스의 타입 (box_code 둘째 토막, 합배송돼도 자기 박스 기준)
//        · requests — 고객 미처리 이동요청이 있는 행
//   ② 칩 필터 (품목 / 쉽먼트에러, SummaryFilterBar)
//        · category — 품목(customs_category, 한글 저장값) 일치 — 미분류는 UNCATEGORIZED
//        · error    — 쉽먼트에러: code 가 null 이면 에러 전체, 아니면 해당 상품 사이즈만
// ============================================================
import type { ShipmentV2Row } from '../types';
import { getBoxType, type ShipmentSizeCode } from './shipmentCodes';

// ── ① 보드 필터 ──
export type BoardFilter =
  | { kind: 'all' }
  | { kind: 'type'; type: ShipmentSizeCode }
  | { kind: 'requests' };

export const BOARD_ALL: BoardFilter = { kind: 'all' };

export const matchesBoard = (row: ShipmentV2Row, board: BoardFilter): boolean => {
  switch (board.kind) {
    case 'all':      return true;
    case 'type':     return getBoxType(row.box_code || '') === board.type;
    case 'requests': return row.move_request !== null;
  }
};

export const isSameBoard = (a: BoardFilter, b: BoardFilter): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'type' && b.kind === 'type') return a.type === b.type;
  return true;
};

// ── ② 칩 필터 ──
export type RowFilter =
  | { kind: 'all' }
  | { kind: 'category'; category: string }
  | { kind: 'error'; code: ShipmentSizeCode | null };

export const FILTER_ALL: RowFilter = { kind: 'all' };

/** 미분류 품목 키 (customs_category 가 비어 있는 행) */
export const UNCATEGORIZED = '';

export const getCategoryKey = (row: Pick<ShipmentV2Row, 'customs_category'>): string =>
  (row.customs_category || '').trim() || UNCATEGORIZED;

export const matchesFilter = (
  row: ShipmentV2Row,
  error: ShipmentSizeCode | null,
  filter: RowFilter
): boolean => {
  switch (filter.kind) {
    case 'all':      return true;
    case 'category': return getCategoryKey(row) === filter.category;
    case 'error':    return error !== null && (filter.code === null || error === filter.code);
  }
};

// ── 같은 필터인지 (태그 재클릭 → 해제 판단) ──
export const isSameFilter = (a: RowFilter, b: RowFilter): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'category' && b.kind === 'category') return a.category === b.category;
  if (a.kind === 'error' && b.kind === 'error') return a.code === b.code;
  return true;
};
