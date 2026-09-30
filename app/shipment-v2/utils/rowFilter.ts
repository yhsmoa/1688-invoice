// ============================================================
// 쉽먼트 V2 — 요약 보드 필터 (품목 / 쉽먼트에러)
// ============================================================
import type { ShipmentV2Row } from '../types';
import type { ShipmentSizeCode } from './shipmentCodes';

// ── 필터 상태 ──
//   all      : 전체
//   category : 품목(customs_category) 일치 — 미분류는 UNCATEGORIZED
//   error    : 쉽먼트에러 — code 가 null 이면 에러 전체, 아니면 해당 상품 사이즈만
export type RowFilter =
  | { kind: 'all' }
  | { kind: 'category'; category: string }
  | { kind: 'error'; code: ShipmentSizeCode | null };

export const FILTER_ALL: RowFilter = { kind: 'all' };

/** 미분류 품목 키 (customs_category 가 비어 있는 행) */
export const UNCATEGORIZED = '';

export const getCategoryKey = (row: Pick<ShipmentV2Row, 'customs_category'>): string =>
  row.customs_category || UNCATEGORIZED;

// ── 행 일치 여부 ──
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
