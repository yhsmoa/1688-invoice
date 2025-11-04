/**
 * 바코드 수량 계산 유틸리티
 */

/**
 * 입고 수량 변경에 따른 바코드 초기 수량 계산
 * @param originalImportQty 원래 입고 수량
 * @param newImportQty 새로운 입고 수량
 * @returns 바코드 수량 (증가분)
 */
export function calculateBarcodeQuantity(
  originalImportQty: number | null | undefined,
  newImportQty: number | null | undefined
): number {
  const original = originalImportQty ?? 0;
  const newQty = newImportQty ?? 0;

  const difference = newQty - original;

  // 증가분만 반환 (감소한 경우 0)
  return Math.max(0, difference);
}

/**
 * ReadyItem의 바코드 수량 계산
 */
export function calculateReadyItemBarcodeQty(
  originalImportQty: number | null,
  modifiedImportQty: number | null | undefined
): number {
  // modifiedImportQty가 없으면 바코드 수량 0
  if (modifiedImportQty === null || modifiedImportQty === undefined) {
    return 0;
  }

  return calculateBarcodeQuantity(originalImportQty, modifiedImportQty);
}
