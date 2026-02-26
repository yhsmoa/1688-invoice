import { useState } from 'react';
import { ItemData } from './useItemData';

// F열 혼용률 타입: 'mixRate' = XLOOKUP 수식, 'backRef' = '뒷장 참조' 텍스트
export type LabelFormulaType = 'mixRate' | 'backRef' | '';

export const useBarcodeDialog = () => {
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [productQuantities, setProductQuantities] = useState<{ [key: string]: number }>({});
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [labelFormulaType, setLabelFormulaType] = useState<LabelFormulaType>('');

  // 바코드 버튼 클릭 핸들러 (Sheet)
  const handleBarcodeClick = (
    selectedRows: Set<string>,
    filteredData: ItemData[]
  ) => {
    if (selectedRows.size === 0) {
      alert('바코드를 생성할 항목을 선택해주세요.');
      return;
    }

    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));
    const itemsWithBarcode = selectedItems.filter(item => item.barcode);

    if (itemsWithBarcode.length === 0) {
      alert('선택한 항목에 바코드 정보가 없습니다.');
      return;
    }

    const initialQuantities: { [key: string]: number } = {};
    itemsWithBarcode.forEach(item => {
      initialQuantities[item.id] = item.import_qty || 1;
    });
    setProductQuantities(initialQuantities);
    setLabelFormulaType('');  // 다이얼로그 열 때 초기화
    setShowQuantityDialog(true);
  };

  // 바코드 DB 저장 버튼 클릭 핸들러
  const handleBarcodeDBClick = async (
    selectedRows: Set<string>,
    filteredData: ItemData[],
    setSelectedRows: (rows: Set<string>) => void
  ) => {
    if (selectedRows.size === 0) {
      alert('바코드를 생성할 항목을 선택해주세요.');
      return;
    }

    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));
    const itemsWithBarcode = selectedItems.filter(item => item.barcode);

    if (itemsWithBarcode.length === 0) {
      alert('선택한 항목에 바코드 정보가 없습니다.');
      return;
    }

    try {
      setIsSavingLabel(true);

      const barcodeData = itemsWithBarcode.map((item, index) => ({
        id: String(index + 1).padStart(4, '0'),
        brand: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
        item_name: `${item.china_option1 || ''}${item.china_option1 && item.china_option2 ? ' ' : ''}${item.china_option2 || ''}`.trim(),
        barcode: item.barcode || '',
        qty: item.import_qty || 1,
        order_number: item.order_number || ''
      }));

      const response = await fetch('/api/save-barcode-to-db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ barcodeData }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(`바코드 데이터가 DB에 저장되었습니다.\n저장된 아이템: ${result.count}개`);
        setSelectedRows(new Set());
      } else {
        console.error('DB 저장 실패:', result);
        alert(`DB 저장에 실패했습니다.\n오류: ${result.error || '알 수 없는 오류'}`);
      }

    } catch (error) {
      console.error('DB 저장 중 오류:', error);
      alert('DB 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingLabel(false);
    }
  };

  // 수량 입력 후 LABEL 시트에 저장
  const handleQuantityConfirm = async (
    selectedCoupangUser: string,
    filteredData: ItemData[],
    setSelectedRows: (rows: Set<string>) => void
  ) => {
    if (!selectedCoupangUser) {
      alert('먼저 쿠팡 사용자를 선택해주세요.');
      return;
    }

    setIsSavingLabel(true);

    const cacheKey = `sheet_data_${selectedCoupangUser}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!cachedData) {
      alert('구글시트 데이터를 먼저 불러와주세요.');
      setIsSavingLabel(false);
      return;
    }

    let googlesheetId;
    try {
      const parsedCache = JSON.parse(cachedData);
      googlesheetId = parsedCache.googlesheet_id;
    } catch (error) {
      console.error('캐시 파싱 오류:', error);
      alert('구글시트 정보를 가져올 수 없습니다.');
      setIsSavingLabel(false);
      return;
    }

    if (!googlesheetId) {
      alert('구글시트 ID를 찾을 수 없습니다. 다시 시트를 불러와주세요.');
      setIsSavingLabel(false);
      return;
    }

    // 주문번호에서 세번째 '-' 이후 제거 (BZ-260120-0045-A01 → BZ-260120-0045)
    const truncateOrderNumber = (orderNum: string): string => {
      if (!orderNum) return '';
      const parts = orderNum.split('-');
      return parts.slice(0, 3).join('-');
    };

    // 바코드 정규화 함수 (주문번호 형태인 경우만 정규화: BZ-260123-0006-S21 → BZ-260123-0006)
    const normalizeBarcode = (barcode: string): string => {
      if (!barcode) return '';
      // 주문번호 형태인지 확인 (XX-XXXXXX-XXXX 패턴)
      const parts = barcode.split('-');
      if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) {
        // 주문번호 형태이면 세번째 '-' 이후 제거
        return parts.slice(0, 3).join('-');
      }
      // 일반 바코드는 그대로 반환
      return barcode;
    };

    const labelData: Array<{name: string, barcode: string, qty: number, order_number: string, sizeCode: string}> = [];

    Object.entries(productQuantities).forEach(([id, quantity]) => {
      const item = filteredData.find(item => item.id === id);
      if (item && item.barcode) {
        // 주문번호 정리: 세번째 '-' 이후 제거
        const orderNumber = truncateOrderNumber(item.order_number || '');

        // H열용 사이즈 코드 결정 (주문번호에 추가하지 않고 별도 저장)
        let sizeCode = '';
        if (item.product_size && item.product_size.trim()) {
          const sizeText = item.product_size.trim();
          const sizeLower = sizeText.toLowerCase();
          if (sizeLower.includes('small')) {
            sizeCode = 'A';
          } else if (sizeLower.includes('medium')) {
            sizeCode = 'B';
          } else if (sizeLower.includes('large')) {
            sizeCode = 'C';
          } else if (sizeLower.includes('p-')) {
            sizeCode = 'P';
          } else if (sizeLower.includes('direct')) {
            sizeCode = 'X';
          }
        }

        labelData.push({
          name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
          barcode: normalizeBarcode(item.barcode),
          qty: quantity,
          order_number: orderNumber,
          sizeCode: sizeCode
        });
      }
    });

    // 중복 주문번호 제거 (동일한 order_number는 하나만 유지)
    const uniqueLabelData: typeof labelData = [];
    const seenOrderNumbers = new Set<string>();

    labelData.forEach(item => {
      if (!seenOrderNumbers.has(item.order_number)) {
        seenOrderNumbers.add(item.order_number);
        uniqueLabelData.push(item);
      }
    });

    const finalLabelData = uniqueLabelData;

    if (finalLabelData.length > 0) {
      try {
        console.log('LABEL 시트에 데이터 저장 시작...');
        console.log('저장할 데이터:', finalLabelData);

        const response = await fetch('/api/save-label-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            labelData: finalLabelData,
            googlesheet_id: googlesheetId,
            coupang_name: selectedCoupangUser,
            labelFormulaType: labelFormulaType || 'mixRate'
          }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          alert(`LABEL 시트에 바코드 데이터가 저장되었습니다.\n저장된 아이템: ${result.count}개`);

          setShowQuantityDialog(false);
          setProductQuantities({});
          setSelectedRows(new Set());
        } else {
          console.error('LABEL 시트 저장 실패:', result);
          alert(`LABEL 시트 저장에 실패했습니다.\n오류: ${result.message || result.error || '알 수 없는 오류'}`);
        }

      } catch (error) {
        console.error('LABEL 시트 저장 중 오류:', error);
        alert('LABEL 시트 저장 중 오류가 발생했습니다.');
      } finally {
        setIsSavingLabel(false);
      }
    } else {
      setIsSavingLabel(false);
    }
  };

  return {
    showQuantityDialog,
    setShowQuantityDialog,
    productQuantities,
    setProductQuantities,
    isSavingLabel,
    setIsSavingLabel,
    labelFormulaType,
    setLabelFormulaType,
    handleBarcodeClick,
    handleBarcodeDBClick,
    handleQuantityConfirm
  };
};
