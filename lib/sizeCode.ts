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

// ============================================================
// 입고 후 경로 — 포장 타입(A/B/C/P/X)과 독립된 두 번째 축
//
//   SHIPMENT : 입고 → 상품출고 V2 → 쉽먼트 (기존 흐름)
//   STOCK    : 입고 → 재고(보관) 위치에 배치 → [재고] 에서 쉽먼트로
//   화면에서는 타입 배지 옆 노란 [S] 칩 (component/StockChip.tsx)
//   purchase-agent lib/sizeCode.ts 에 같은 헬퍼 — 바꾸면 양쪽 같이
// ============================================================
export function isStockRoute(item: { arrival_route?: string | null } | null | undefined): boolean {
  return item?.arrival_route === 'STOCK';
}

// ── 화면의 "타입" 한 축 — S(보관) 이면 S 단독, 아니면 A/B/C/P/X ──
//   S 상품은 보관 경로인 동안(재고에서 꺼내 타입이 기록된 뒤에도) 화면에는 S 만 보인다.
//   정해진 박스 타입은 재고 담기 모달·쉽먼트 V2(박스) 에서 본다.
//   purchase-agent lib/sizeCode.ts 의 같은 함수와 규칙 동일 — 바꾸면 양쪽 같이
export type TypeBadgeInfo = SizeBadge;

export function resolveTypeBadge(item: {
  arrival_route?: string | null;
  shipment_type?: string | null;
  coupang_shipment_size?: string | null;
} | null | undefined): TypeBadgeInfo | null {
  if (!item) return null;
  if (isStockRoute(item)) return { code: 'S', colorClass: 'size-badge--stock' };
  return resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
}

// ============================================================
// 스캔 사이즈 검증용 결합 헬퍼
//
// /export-product-v2 바코드 스캔 시, 박스 사이즈와 비교할
// 상품 사이즈 코드를 결정한다.
//
// 단일 소스: ft_order_items.shipment_type + ft_order_items.coupang_shipment_size
// (화면 배지 표시와 동일한 값을 사용 — 데이터 소스 일원화)
//
// 규칙:
//   PERSONAL                → P
//   COUPANG + Small/Med/Lg → A/B/C
//   COUPANG (size 매칭 실패) → X (fallback)
//   DIRECT / null / 기타    → X
// ============================================================
export function resolveScanSizeCode(
  shipmentType: string | null | undefined,
  coupangShipmentSize: string | null | undefined
): string {
  const type = shipmentType?.trim().toUpperCase() ?? '';
  if (type === 'PERSONAL') return 'P';
  if (type === 'COUPANG') {
    return normalizeSizeCode(coupangShipmentSize) || 'X';
  }
  return 'X';
}
