// ============================================================
// 쉽먼트 사이즈 정규화 유틸
// Small → A, Medium → B, Large → C, P-xxx → P, Direct → X
// ============================================================

/**
 * shipment_size_legacy 원본값 → 정규화된 사이즈 코드 변환
 * @param raw  DB 원본값 (Small, Medium, Large, P-xxxx, Direct, null 등)
 * @returns    정규화 코드 (A, B, C, P, X) 또는 null
 */
export function normalizeSizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (lower === 'small') return 'A';
  if (lower === 'medium') return 'B';
  if (lower === 'large') return 'C';
  if (lower.startsWith('p-')) return 'P';
  if (lower === 'direct') return 'X';

  // 이미 정규화된 값이면 그대로 반환
  if (['A', 'B', 'C', 'P', 'X'].includes(trimmed.toUpperCase())) return trimmed.toUpperCase();

  return null;
}
