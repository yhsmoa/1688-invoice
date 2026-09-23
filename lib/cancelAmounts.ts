// ============================================================
// 취소/반품 금액 계산 (ft_cancel_details)
//
// 사용처: 접수 모달(import-product-v2 V2CancelModal), 반품 화면(return-product-v2)
//
// 환불 총액(total_refund_cny)의 원본 값은 DB 트리거
// ft_cancel_details_sync_amounts 가 저장 시 계산한다.
// 여기 calcTotalRefund 는 저장 전 화면 표시용이며, 트리거와 같은 식을 유지해야 한다
// (MIGRATION_CANCEL_PRICE_RENAME.sql 참고).
// ============================================================

/** 서비스료 비율 (상품가격의 6%) */
export const SERVICE_FEE_RATE = 0.06;

/** 소수 2자리 반올림 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── 서비스료 — 상품가격 × 6% ──
export function calcServiceFee(price: number): number {
  return round2(price * SERVICE_FEE_RATE);
}

// ── 환불 총액 — 상품가격 + 배송비 + 서비스 ──
//   · 세 값이 모두 비어 있으면 null (금액 미확정 — 0 과 구분)
//   · 일부만 비어 있으면 빈 값은 0 으로 보고 합산
export function calcTotalRefund(
  price: number | null,
  delivery: number | null,
  serviceFee: number | null
): number | null {
  if (price == null && delivery == null && serviceFee == null) return null;
  return round2((price ?? 0) + (delivery ?? 0) + (serviceFee ?? 0));
}
