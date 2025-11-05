import { useState } from 'react';
import { ItemData } from './useItemData';
import { hasValueChanged } from '../utils/dataComparison';
import { calculateBarcodeQuantity } from '../utils/barcodeCalculator';

export interface ReadyItem {
  id: string;
  img_url: string | null;
  order_number: string;
  barcode: string;
  product_name: string;
  order_option: string;
  progress: string | null;
  import_qty: number | null;
  cancel_qty: number | null;
  memo: string | null;
  barcode_qty: number; // 바코드 수량 (입고 증가분)
  original_import_qty: number | null; // 원본 입고 수량 (바코드 계산용)
  modifiedFields: {
    import_qty?: number | null;
    cancel_qty?: number | null;
    memo?: string | null;
  };
}

export const useEditCell = (
  filteredData: ItemData[],
  setFilteredData: (data: ItemData[]) => void,
  itemData: ItemData[],
  setItemData: (data: ItemData[]) => void,
  paginatedData: ItemData[],
  originalData: ItemData[]
) => {
  const [editingCell, setEditingCell] = useState<{id: string, field: string} | null>(null);
  const [cellValue, setCellValue] = useState<string>('');
  const [modifiedData, setModifiedData] = useState<{[key: string]: {[field: string]: number | string | null}}>({});
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);

  // 셀 편집 시작
  const startEditingCell = (id: string, field: string, value: number | string | null | undefined) => {
    setEditingCell({ id, field });
    if (field === 'note') {
      setCellValue(value ? value.toString() : '');
    } else {
      setCellValue(value !== null && value !== undefined ? value.toString() : '');
    }
  };

  // 다음 편집 가능한 셀로 이동
  const moveToNextEditableCell = (currentId: string, currentField: string) => {
    const editableFields = ['import_qty', 'cancel_qty', 'note'];
    const currentFieldIndex = editableFields.indexOf(currentField);

    if (currentField === 'import_qty') {
      const currentIndex = paginatedData.findIndex(item => item.id === currentId);
      if (currentIndex >= 0 && currentIndex < paginatedData.length - 1) {
        const nextItem = paginatedData[currentIndex + 1];
        startEditingCell(nextItem.id, 'import_qty', nextItem.import_qty);
      }
    } else {
      if (currentFieldIndex < editableFields.length - 1) {
        const nextField = editableFields[currentFieldIndex + 1];
        const currentItem = paginatedData.find(item => item.id === currentId);
        if (currentItem) {
          startEditingCell(currentId, nextField, currentItem[nextField as keyof ItemData]);
        }
      }
    }
  };

  // 셀 편집 완료
  const finishEditingCell = async (moveToNext: boolean = false) => {
    if (editingCell) {
      const { id, field } = editingCell;

      // 원본 아이템 찾기
      const currentItem = filteredData.find(item => item.id === id);
      if (!currentItem) {
        setEditingCell(null);
        return;
      }

      const currentValue = currentItem[field as keyof ItemData];

      // 입력된 값과 현재 표시된 값이 같은지 비교
      let finalValue: string | number | null;
      let valueChanged = false;

      if (field === 'note') {
        // 비고 필드
        finalValue = cellValue === '' ? '' : cellValue;
        // 현재 값이 null이고 입력값이 빈 문자열이면 변경 없음
        const normalizedCurrent = currentValue === null ? '' : String(currentValue);
        const normalizedFinal = finalValue === '' ? '' : String(finalValue);
        valueChanged = normalizedCurrent !== normalizedFinal;
      } else {
        // 숫자 필드 (import_qty, cancel_qty)
        // 입력값이 비어있으면 원래 값 유지
        if (cellValue === '') {
          finalValue = currentValue as number | null;
          valueChanged = false;
        } else {
          finalValue = Number(cellValue);
          // null과 빈 문자열은 같은 것으로 처리
          const normalizedCurrent = currentValue === null || currentValue === undefined ? null : Number(currentValue);
          valueChanged = normalizedCurrent !== finalValue;
        }
      }

      console.log('=== finishEditingCell 디버깅 ===');
      console.log('필드:', field);
      console.log('cellValue (입력값):', cellValue);
      console.log('currentValue (현재값):', currentValue);
      console.log('finalValue (최종값):', finalValue);
      console.log('valueChanged:', valueChanged);

      if (valueChanged) {
        const updatedData = filteredData.map(item =>
          item.id === id ? { ...item, [field]: finalValue } : item
        );

        setFilteredData(updatedData);

        const updatedItemData = itemData.map(item =>
          item.id === id ? { ...item, [field]: finalValue } : item
        );

        setItemData(updatedItemData);

        const updatedItem = updatedData.find(item => item.id === id);

        if (updatedItem && updatedItem.order_number && updatedItem.barcode) {
          const itemKey = `${updatedItem.order_number}|${updatedItem.barcode}`;

          // 원본 데이터와 비교하여 실제로 변경되었는지 확인
          const isChangedFromOriginal = hasValueChanged(
            originalData,
            updatedItem.id,
            field,
            finalValue
          );

          console.log('=== 셀 편집 완료 디버깅 ===');
          console.log('항목 ID:', updatedItem.id);
          console.log('필드:', field);
          console.log('최종 값:', finalValue);
          console.log('원본과 비교 결과:', isChangedFromOriginal);
          console.log('원본 데이터 개수:', originalData.length);

          if (isChangedFromOriginal) {
            console.log('→ 원본과 다름, modifiedData에 추가');
            // 원본과 다르면 처리준비 목록에 추가
            setModifiedData(prev => ({
              ...prev,
              [itemKey]: {
                ...(prev[itemKey] || {}),
                [field]: finalValue
              }
            }));

            setReadyItems(prev => {
              const existingIndex = prev.findIndex(item => item.id === updatedItem.id);

              // 원본 데이터에서 원본 입고 수량 가져오기
              const originalItem = originalData.find(item => item.id === updatedItem.id);
              const originalImportQty = originalItem?.import_qty ?? null;

              // 바코드 수량 계산 (입고 증가분)
              const barcodeQty = calculateBarcodeQuantity(
                originalImportQty,
                updatedItem.import_qty
              );

              const readyItem: ReadyItem = {
                id: updatedItem.id,
                img_url: updatedItem.img_url || null,
                order_number: updatedItem.order_number,
                barcode: updatedItem.barcode || '',
                product_name: `${updatedItem.product_name || ''}${updatedItem.product_name && updatedItem.product_name_sub ? ', ' : ''}${updatedItem.product_name_sub || ''}`.trim(),
                order_option: `${updatedItem.china_option1 || ''}${updatedItem.china_option1 && updatedItem.china_option2 ? ' ' : ''}${updatedItem.china_option2 || ''}`.trim(),
                progress: updatedItem.progress_qty?.toString() || null,
                import_qty: updatedItem.import_qty ?? null,
                cancel_qty: updatedItem.cancel_qty ?? null,
                memo: updatedItem.note || null,
                barcode_qty: barcodeQty,
                original_import_qty: originalImportQty,
                modifiedFields: {
                  ...(existingIndex >= 0 ? prev[existingIndex].modifiedFields : {}),
                  [field]: finalValue
                }
              };

              if (existingIndex >= 0) {
                const newItems = [...prev];
                newItems[existingIndex] = readyItem;
                return newItems;
              } else {
                return [...prev, readyItem];
              }
            });
          } else {
            console.log('→ 원본과 같음, modifiedData에서 제거');
            // 원본과 같아졌으면 처리준비 목록에서 제거
            setModifiedData(prev => {
              const newModifiedData = { ...prev };
              if (newModifiedData[itemKey]) {
                delete newModifiedData[itemKey][field];
                // 해당 itemKey의 모든 필드가 원본으로 돌아갔으면 itemKey 자체를 삭제
                if (Object.keys(newModifiedData[itemKey]).length === 0) {
                  delete newModifiedData[itemKey];
                }
              }
              return newModifiedData;
            });

            setReadyItems(prev => {
              // 해당 항목이 모든 필드에서 원본과 같아졌는지 확인
              const hasOtherChanges = ['import_qty', 'cancel_qty', 'note'].some(f =>
                f !== field && hasValueChanged(originalData, updatedItem.id, f, updatedItem[f as keyof ItemData])
              );

              if (!hasOtherChanges) {
                // 다른 변경사항도 없으면 처리준비 목록에서 완전히 제거
                return prev.filter(item => item.id !== updatedItem.id);
              } else {
                // 다른 변경사항이 있으면 해당 필드만 업데이트
                return prev.map(item => {
                  if (item.id === updatedItem.id) {
                    const modifiedFields = { ...item.modifiedFields };
                    delete modifiedFields[field as keyof typeof modifiedFields];
                    return {
                      ...item,
                      [field]: finalValue,
                      modifiedFields
                    };
                  }
                  return item;
                });
              }
            });
          }
        }
      }

      const currentId = id;
      const currentField = field;
      setEditingCell(null);

      if (moveToNext) {
        setTimeout(() => {
          moveToNextEditableCell(currentId, currentField);
        }, 50);
      }
    }
  };

  // 셀 값 변경
  const handleCellValueChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // note 필드는 모든 문자 허용, 그 외는 숫자만
    if (editingCell?.field === 'note') {
      setCellValue(e.target.value);
    } else {
      const value = e.target.value.replace(/[^0-9]/g, '');
      setCellValue(value);
    }
  };

  // 셀 키 이벤트 처리
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // note 필드에서 Enter 키는 줄바꿈
    if (editingCell?.field === 'note') {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        // Enter만 누르면 줄바꿈 (기본 동작)
        return;
      } else if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
        // Shift+Enter 또는 Ctrl+Enter는 저장 후 다음 셀로 이동
        e.preventDefault();
        finishEditingCell(true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finishEditingCell();
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      }
    } else {
      // 다른 필드는 기존 동작 유지
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEditingCell(true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        finishEditingCell();
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      }
    }
  };

  return {
    editingCell,
    cellValue,
    setCellValue,
    modifiedData,
    setModifiedData,
    readyItems,
    setReadyItems,
    startEditingCell,
    finishEditingCell,
    handleCellValueChange,
    handleCellKeyDown
  };
};
