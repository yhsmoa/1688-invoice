// ============================================================
// 쉽먼트 V2 — 박스 타입 / 사이즈 코드 유틸
// ============================================================

// ── 박스 타입 추출 (BZ-A-01 → A) ──
export const getBoxType = (code: string): string => {
  const parts = code.split('-');
  return parts.length >= 2 ? parts[1].toUpperCase() : '';
};

// ── 배지 색상 클래스 (박스타입 & 사이즈코드 공용) ──
export const getBadgeClass = (code: string): string => {
  switch (code) {
    case 'A': case 'B': case 'C': return 'shipment-v2-badge--blue';
    case 'P': return 'shipment-v2-badge--orange';
    case 'X': return 'shipment-v2-badge--black';
    default:  return 'shipment-v2-badge--gray';
  }
};

// ============================================================
// 쉽먼트 에러 (상품 사이즈 코드 ≠ 박스 타입)
//   A상품→A박스, B→B, C→C, P→P, X→X 가 정상.
//   상품 코드는 size_code (주문의 shipment_type 기준: PERSONAL→P, DIRECT→X,
//   COUPANG→A/B/C) — 상품출고 V2 스캔 검증과 같은 기준이라 P/X 는 A/B/C 사이즈와 무관.
//   상품 코드·박스 타입 중 하나라도 A/B/C/P/X 가 아니면 판정하지 않는다.
// ============================================================
export const SHIPMENT_SIZE_CODES = ['A', 'B', 'C', 'P', 'X'] as const;
export type ShipmentSizeCode = typeof SHIPMENT_SIZE_CODES[number];

const isShipmentSizeCode = (code: string | null): code is ShipmentSizeCode =>
  !!code && (SHIPMENT_SIZE_CODES as readonly string[]).includes(code);

/** 박스 타입과 다른 경우 상품 사이즈 코드를, 정상·판정 불가면 null 반환 */
export const getShipmentError = (
  row: { box_code: string | null; size_code: string | null }
): ShipmentSizeCode | null => {
  const size = row.size_code;
  const box  = getBoxType(row.box_code || '');
  if (!isShipmentSizeCode(size) || !isShipmentSizeCode(box)) return null;
  return size === box ? null : size;
};
