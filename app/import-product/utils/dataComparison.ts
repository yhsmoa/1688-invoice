/**
 * 데이터 비교 유틸리티 함수들
 */

export interface ItemData {
  id: string;
  [key: string]: any;
}

/**
 * 원본 데이터에서 특정 항목의 원본 값을 찾습니다
 * @param originalData 원본 데이터 배열
 * @param itemId 항목 ID
 * @param field 필드명
 * @returns 원본 값 또는 null
 */
export function getOriginalValue(
  originalData: ItemData[],
  itemId: string,
  field: string
): any {
  const originalItem = originalData.find(item => item.id === itemId);
  return originalItem ? originalItem[field] : null;
}

/**
 * 현재 값이 원본 값과 다른지 확인합니다
 * @param originalData 원본 데이터 배열
 * @param itemId 항목 ID
 * @param field 필드명
 * @param currentValue 현재 값
 * @returns 값이 변경되었으면 true, 아니면 false
 */
export function hasValueChanged(
  originalData: ItemData[],
  itemId: string,
  field: string,
  currentValue: any
): boolean {
  const originalValue = getOriginalValue(originalData, itemId, field);

  // null 처리: null과 undefined를 동일하게 취급
  const normalizedOriginal = originalValue === undefined ? null : originalValue;
  const normalizedCurrent = currentValue === undefined ? null : currentValue;

  // 완전히 동일한지 먼저 확인 (null, undefined 포함)
  if (normalizedOriginal === normalizedCurrent) {
    return false; // 변경 없음
  }

  // 숫자 비교 (입고 수량 등) - 단, 둘 다 null이 아닐 때만
  if (normalizedOriginal !== null && normalizedCurrent !== null) {
    // 숫자로 변환 가능한 경우
    const origNum = Number(normalizedOriginal);
    const currNum = Number(normalizedCurrent);
    if (!isNaN(origNum) && !isNaN(currNum)) {
      return origNum !== currNum;
    }
  }

  // 기본 비교 (문자열, 그 외)
  return normalizedOriginal !== normalizedCurrent;
}

/**
 * 항목의 어떤 필드라도 원본과 다른지 확인합니다
 * @param originalData 원본 데이터 배열
 * @param currentItem 현재 항목 데이터
 * @param fieldsToCheck 확인할 필드 목록
 * @returns 하나라도 변경되었으면 true
 */
export function hasAnyFieldChanged(
  originalData: ItemData[],
  currentItem: ItemData,
  fieldsToCheck: string[]
): boolean {
  return fieldsToCheck.some(field =>
    hasValueChanged(originalData, currentItem.id, field, currentItem[field])
  );
}
