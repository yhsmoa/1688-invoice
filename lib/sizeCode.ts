// ============================================================
// 쉽먼트 배지 유틸
//
// 우선순위:
//   shipment_type = DIRECT   → X (black)
//   shipment_type = PERSONAL → P (orange)
//   shipment_type = COUPANG  → coupang_shipment_size 기반: Small→A / Medium→B / Large→C (blue)
//   fallback (레거시)         → coupang_shipment_size 직접 파싱
// ============================================================

export interface SizeBadge {
  code:       string;
  colorClass: string; // size-badge--blue | size-badge--orange | size-badge--black | size-badge--gray
}

/**
 * shipment_type + coupang_shipment_size 조합으로 배지 정보 반환
 * @returns SizeBadge | null  (표시할 배지가 없으면 null)
 */
export function resolveSizeBadge(
  shipmentType:       string | null | undefined,
  coupangShipmentSize: string | null | undefined
): SizeBadge | null {

  const type = shipmentType?.trim().toUpperCase() ?? '';

  // ── DIRECT ──────────────────────────────────────────────────
  if (type === 'DIRECT') {
    return { code: 'X', colorClass: 'size-badge--black' };
  }

  // ── PERSONAL ────────────────────────────────────────────────
  if (type === 'PERSONAL') {
    return { code: 'P', colorClass: 'size-badge--orange' };
  }

  // ── COUPANG: coupang_shipment_size 로 A/B/C 결정 ────────────
  if (type === 'COUPANG') {
    const size = coupangShipmentSize?.trim().toLowerCase() ?? '';
    if (size === 'small')  return { code: 'A', colorClass: 'size-badge--blue' };
    if (size === 'medium') return { code: 'B', colorClass: 'size-badge--blue' };
    if (size === 'large')  return { code: 'C', colorClass: 'size-badge--blue' };
    // COUPANG 이지만 size 값이 없거나 알 수 없는 경우: 회색
    if (size) return { code: coupangShipmentSize!, colorClass: 'size-badge--gray' };
    return null;
  }

  // ── fallback: shipment_type 없이 coupang_shipment_size 만 있는 레거시 ──
  if (coupangShipmentSize) {
    const raw = coupangShipmentSize.trim().toLowerCase();
    if (raw === 'small')         return { code: 'A', colorClass: 'size-badge--blue' };
    if (raw === 'medium')        return { code: 'B', colorClass: 'size-badge--blue' };
    if (raw === 'large')         return { code: 'C', colorClass: 'size-badge--blue' };
    if (raw.startsWith('p-'))   return { code: 'P', colorClass: 'size-badge--orange' };
    if (raw === 'direct')        return { code: 'X', colorClass: 'size-badge--black' };
    return { code: coupangShipmentSize, colorClass: 'size-badge--gray' };
  }

  return null;
}

/**
 * @deprecated resolveSizeBadge 사용 권장
 * coupang_shipment_size 원본값 → 정규화 코드 (A/B/C/P/X)
 */
export function normalizeSizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === 'small')        return 'A';
  if (lower === 'medium')       return 'B';
  if (lower === 'large')        return 'C';
  if (lower.startsWith('p-'))  return 'P';
  if (lower === 'direct')       return 'X';

  if (['A', 'B', 'C', 'P', 'X'].includes(trimmed.toUpperCase())) return trimmed.toUpperCase();

  return null;
}
