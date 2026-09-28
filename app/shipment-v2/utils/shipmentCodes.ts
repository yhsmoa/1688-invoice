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

// ── 쉽먼트사이즈 정규화 (프론트용) ──
//   Small → A, Medium → B, Large → C, P-xxx → P, Direct → X
export const normalizeSizeDisplay = (raw: string | null): string | null => {
  if (!raw) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'small') return 'A';
  if (lower === 'medium') return 'B';
  if (lower === 'large') return 'C';
  if (lower.startsWith('p-')) return 'P';
  if (lower === 'direct') return 'X';
  if (['a', 'b', 'c', 'p', 'x'].includes(lower)) return lower.toUpperCase();
  return raw;
};
