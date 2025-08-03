'use client';

import React, { useState, useEffect, useRef } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './ExportProduct.css';

interface ProductData {
  id: string;
  order_number: string;
  product_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  ordered_qty: number | null;
  import_qty: number | null;
  cancel_qty: number | null;
  img_url: string | null;
  barcode: string | null;
  export_qty?: number; // 출고 수량 추가
}

interface ShipmentData {
  id: string;
  box_number: string;
  barcode: string;
  product_name: string;
  order_option: string;
  quantity: number;
}

const ExportProduct: React.FC = () => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [quantityInput, setQuantityInput] = useState('');
  const [selectedBox, setSelectedBox] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [productData, setProductData] = useState<ProductData[]>([]);
  const [filteredData, setFilteredData] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [editingExportId, setEditingExportId] = useState<string | null>(null);
  const [editingExportValue, setEditingExportValue] = useState('');
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [editingShipmentValue, setEditingShipmentValue] = useState('');
  const [shipmentData, setShipmentData] = useState<ShipmentData[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Supabase에서 데이터 가져오기
  const fetchProductData = async (): Promise<ProductData[]> => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/get-import-products', {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('데이터를 불러오는데 실패했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        setProductData(result.data);
        console.log('최신 데이터 로드 완료:', result.data.length, '개 항목');
        return result.data;
      } else {
        setProductData([]);
        return [];
      }
      
    } catch (error) {
      console.error('데이터 가져오기 오류:', error);
      setProductData([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProductData();
  }, []);

  // 알림 모달 표시 함수 (바코드 스캔 관련 오류)
  const showAlertModal = (message: string) => {
    setAlertMessage(message);
    setShowAlert(true);
    setTimeout(() => {
      setShowAlert(false);
    }, 2000);
  };

  // 토스트 알림 표시 함수 (저장 성공 등)
  const showToastNotification = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  };

  // 출고 데이터 저장 함수
  const saveExportData = async () => {
    try {
      console.log('saveExportData 호출됨, filteredData:', filteredData);
      
      const exportData = filteredData
        .filter(item => item.export_qty && item.export_qty > 0)
        .map(item => ({
          id: item.id,
          export_qty: item.export_qty
        }));

      console.log('저장할 출고 데이터:', exportData);

      // 쉽먼트 데이터도 함께 저장
      await saveShipmentData();

      if (exportData.length === 0) {
        console.log('저장할 출고 데이터 없음');
        showToastNotification('쉽먼트 데이터가 저장되었습니다.');
        return;
      }

      console.log('출고 데이터 API 호출 시작...');
      const response = await fetch('/api/save-export-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ exportData }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API 응답 오류:', errorText);
        throw new Error('출고 데이터 저장에 실패했습니다.');
      }

      const result = await response.json();
      console.log('출고 데이터 저장 성공:', result);
      showToastNotification('출고 및 쉽먼트 데이터가 저장되었습니다.');
      
    } catch (error) {
      console.error('데이터 저장 오류:', error);
      showToastNotification('데이터 저장에 실패했습니다.');
    }
  };

  // 쉽먼트 데이터 저장 함수
  const saveShipmentData = async () => {
    if (shipmentData.length === 0) {
      console.log('저장할 쉽먼트 데이터 없음');
      return;
    }

    try {
      console.log('쉽먼트 데이터 저장 시작:', shipmentData);

      const response = await fetch('/api/save-shipment-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shipmentData }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('쉽먼트 API 응답 오류:', errorText);
        throw new Error('쉽먼트 데이터 저장에 실패했습니다.');
      }

      const result = await response.json();
      console.log('쉽먼트 데이터 저장 성공:', result);
      
      // 저장 후 쉽먼트 데이터 초기화
      setShipmentData([]);
      
    } catch (error) {
      console.error('쉽먼트 데이터 저장 오류:', error);
      throw error;
    }
  };

  // 쉽먼트 데이터 조회 함수
  const fetchShipmentData = async (barcode: string) => {
    try {
      console.log('쉽먼트 데이터 조회:', barcode);

      const response = await fetch(`/api/get-shipment-data?barcode=${encodeURIComponent(barcode)}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('쉽먼트 데이터 조회에 실패했습니다.');
      }

      const result = await response.json();
      console.log('쉽먼트 데이터 조회 결과:', result);

      if (result.success && result.data) {
        // 기존 쉽먼트 데이터에 조회된 데이터 추가 (중복 제거)
        const existingBarcodes = shipmentData.map(item => `${item.box_number}-${item.barcode}`);
        const newData = result.data.filter((item: any) => 
          !existingBarcodes.includes(`${item.box_number}-${item.barcode}`)
        );

        if (newData.length > 0) {
          setShipmentData(prev => [...prev, ...newData]);
          console.log('기존 쉽먼트 데이터 로드됨:', newData.length, '개 항목');
        }
      }
    } catch (error) {
      console.error('쉽먼트 데이터 조회 오류:', error);
      // 조회 실패해도 스캔은 계속 진행
    }
  };

  // 출고 가능 여부 확인 함수
  const checkCanExport = (barcode: string): boolean => {
    const barcodeItems = filteredData
      .filter(item => item.barcode === barcode && (item.import_qty || 0) > 0)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (barcodeItems.length === 0) {
      return false;
    }

    // 출고 가능한 항목이 하나라도 있는지 확인
    for (const item of barcodeItems) {
      const currentExportQty = item.export_qty || 0;
      const importQty = item.import_qty || 0;
      
      if (currentExportQty < importQty) {
        return true; // 출고 가능한 항목 발견
      }
    }

    return false; // 출고 가능한 항목 없음
  };

  // 출고 처리 함수
  const processExport = (barcode: string) => {
    // 현재 표시된 데이터에서 해당 바코드의 항목들을 가져옴
    const barcodeItems = filteredData
      .filter(item => item.barcode === barcode && (item.import_qty || 0) > 0)
      .sort((a, b) => a.id.localeCompare(b.id)); // id 기준 오름차순 정렬

    if (barcodeItems.length === 0) {
      showAlertModal('입고되지 않은 상품입니다.');
      return;
    }

    // 출고 가능한 항목 찾기
    let processed = false;
    for (const item of barcodeItems) {
      const currentExportQty = item.export_qty || 0;
      const importQty = item.import_qty || 0;
      
      if (currentExportQty < importQty) {
        // 해당 항목의 출고 수량 증가
        setFilteredData(prev => prev.map(prevItem => 
          prevItem.id === item.id 
            ? { ...prevItem, export_qty: currentExportQty + 1 }
            : prevItem
        ));
        processed = true;
        break;
      }
    }

    if (!processed) {
      showAlertModal('더 이상 출고 가능한 상품이 없습니다.');
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const currentBarcode = barcodeInput.trim();
    
    if (!currentBarcode) {
      // 바코드가 비어있으면 검색하지 않음
      showAlertModal('바코드를 입력해주세요.');
      return;
    }

    // 박스번호가 선택되지 않으면 스캔 차단
    if (!selectedBox) {
      showAlertModal('박스를 먼저 선택해주세요.');
      return;
    }

    // 이전 바코드와 다른 바코드가 스캔된 경우 자동 저장
    if (lastScannedBarcode && lastScannedBarcode !== currentBarcode && hasSearched) {
      console.log('새로운 바코드 스캔됨 - 이전 데이터 저장:', { lastScannedBarcode, currentBarcode });
      await saveExportData();
    }

    // 현재 바코드가 이미 스캔된 바코드와 같은 경우 (출고 처리)
    if (lastScannedBarcode === currentBarcode && hasSearched && filteredData.length > 0) {
      // === 1. 출고 테이블 처리 ===
      const canExport = checkCanExport(currentBarcode);
      processExport(currentBarcode);
      
      // === 2. 쉽먼트 테이블 처리 (실제 출고된 경우에만) ===
      if (selectedBox && canExport) {
        // 실제로 출고가 가능했던 경우에만 쉽먼트에 추가
        const productItem = filteredData.find(item => item.barcode === currentBarcode);
        if (productItem) {
          addToShipment(currentBarcode, selectedBox, productItem);
        }
      }
      
      // 바코드 입력 필드 초기화 및 포커스
      setBarcodeInput('');
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 10);
      return;
    }

    // 새로운 바코드 검색
    setHasSearched(true);
    setLastScannedBarcode(currentBarcode);
    
    // 새로운 바코드 검색 시 최신 데이터를 다시 가져오기
    console.log('새로운 바코드 검색 - 최신 데이터 가져오는 중...');
    const latestData = await fetchProductData();
    
    // 쉽먼트 데이터도 조회
    await fetchShipmentData(currentBarcode);
    
    // 최신 데이터에서 바코드로 필터링 (barcode 컬럼 기준)
    const filtered = latestData.filter(item => 
      item.barcode && item.barcode.includes(currentBarcode)
    );
    
    if (filtered.length === 0) {
      showAlertModal('조회되지 않는 바코드입니다.');
      setFilteredData([]);
      return;
    }

    // 입고 수량이 0보다 큰 데이터가 있는지 확인
    const hasImportedItems = filtered.some(item => (item.import_qty || 0) > 0);
    
    if (!hasImportedItems) {
      showAlertModal('입고되지 않은 상품입니다.');
      setFilteredData(filtered.map(item => ({ 
        ...item, 
        export_qty: item.export_qty || 0 
      })));
      return;
    }

    // 기존 출고 수량을 유지하면서 데이터 설정 (0으로 초기화하지 않음)
    const initialData = filtered.map(item => ({ 
      ...item, 
      export_qty: item.export_qty || 0  // 기존 값이 있으면 유지, 없으면 0
    }));
    setFilteredData(initialData);
    
    // 첫 번째 출고 처리 - 출고 가능한지 확인 후 처리
    const barcodeItems = initialData
      .filter(item => item.barcode === currentBarcode && (item.import_qty || 0) > 0)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (barcodeItems.length > 0) {
      // === 1. 출고 테이블 처리 (독립적) ===
      let processed = false;
      for (const item of barcodeItems) {
        const currentExportQty = item.export_qty || 0;
        const importQty = item.import_qty || 0;
        
        if (currentExportQty < importQty) {
          // 해당 항목의 출고 수량 증가
          const updatedData = initialData.map(prevItem => 
            prevItem.id === item.id 
              ? { ...prevItem, export_qty: currentExportQty + 1 }
              : prevItem
          );
          setFilteredData(updatedData);
          processed = true;
          break;
        }
      }

      // 출고 가능한 항목이 없는 경우에만 알림
      if (!processed) {
        showAlertModal('더 이상 출고 가능한 상품이 없습니다.');
      }
      
      // === 2. 쉽먼트 테이블 처리 (실제 출고된 경우에만) ===
      if (selectedBox && processed && barcodeItems.length > 0) {
        // 실제로 출고가 성공한 경우에만 쉽먼트에 추가
        addToShipment(currentBarcode, selectedBox, barcodeItems[0]);
      }
    }

    // 바코드 입력 필드 초기화 및 포커스
    setBarcodeInput('');
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 10);
  };

  // 숫자 표시 함수 (0이면 빈 문자열 반환)
  const displayNumber = (value: number | null) => {
    return value && value > 0 ? value : '';
  };

  // 출고 값 편집 시작
  const startEditExport = (item: ProductData) => {
    setEditingExportId(item.id);
    setEditingExportValue(String(item.export_qty || 0));
  };

  // 출고 값 편집 완료 (DB 저장 포함)
  const finishEditExport = async (itemId: string) => {
    console.log('finishEditExport 호출됨:', { itemId, editingExportValue });
    
    const newValue = parseInt(editingExportValue) || 0;
    
    // 해당 항목의 입고 수량 확인
    const item = filteredData.find(item => item.id === itemId);
    const importQty = item?.import_qty || 0;
    
    console.log('수정 요청:', { newValue, importQty, itemId });
    
    // 입고 수량보다 큰 값으로 수정 시도하는 경우
    if (newValue > importQty) {
      showToastNotification(`출고 수량은 입고 수량(${importQty})을 초과할 수 없습니다.`);
      setEditingExportId(null);
      setEditingExportValue('');
      return;
    }
    
    try {
      console.log('DB 저장 시도 중...');
      
      // DB에 바로 저장
      const response = await fetch('/api/save-export-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          exportData: [{ id: itemId, export_qty: newValue }] 
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('API 응답 오류:', errorData);
        throw new Error('출고 데이터 저장에 실패했습니다.');
      }

      const result = await response.json();
      console.log('DB 저장 성공:', result);

      // 성공 시 UI 업데이트
      setFilteredData(prev => prev.map(item => 
        item.id === itemId 
          ? { ...item, export_qty: newValue }
          : item
      ));
      
      showToastNotification('출고 수량이 저장되었습니다.');
      
    } catch (error) {
      console.error('출고 값 저장 오류:', error);
      showToastNotification('출고 수량 저장에 실패했습니다.');
    }
    
    console.log('편집 모드 종료');
    setEditingExportId(null);
    setEditingExportValue('');
  };

  // 출고 값 편집 취소
  const cancelEditExport = () => {
    setEditingExportId(null);
    setEditingExportValue('');
  };

  // 행 배경색 결정 함수
  const getRowClassName = (item: ProductData) => {
    const importQty = item.import_qty || 0;
    const exportQty = item.export_qty || 0;
    
    if (importQty === 0) return 'export-row-no-import';
    if (importQty === exportQty && exportQty > 0) return 'export-row-completed';
    return '';
  };

  // 쉬먼트 개수 편집 시작
  const startEditShipment = (item: ShipmentData) => {
    setEditingShipmentId(item.id);
    setEditingShipmentValue(String(item.quantity));
  };

  // 쉬먼트 개수 편집 완료
  const finishEditShipment = (itemId: string) => {
    const newValue = parseInt(editingShipmentValue) || 0;
    
    if (newValue <= 0) {
      // 0 이하가 되면 해당 행 삭제
      setShipmentData(prev => prev.filter(item => item.id !== itemId));
      showToastNotification('쉬먼트 항목이 삭제되었습니다.');
    } else {
      // 개수 업데이트
      setShipmentData(prev => prev.map(item => 
        item.id === itemId 
          ? { ...item, quantity: newValue }
          : item
      ));
      showToastNotification('쉬먼트 개수가 수정되었습니다.');
    }
    
    setEditingShipmentId(null);
    setEditingShipmentValue('');
  };

  // 쉬먼트 개수 편집 취소
  const cancelEditShipment = () => {
    setEditingShipmentId(null);
    setEditingShipmentValue('');
  };

  // 쉬먼트 데이터 추가 함수
  const addToShipment = (barcode: string, boxNumber: string, productItem: ProductData) => {
    const productName = [productItem.product_name, productItem.option_name]
      .filter(Boolean)
      .join('\n');
    
    const orderOption = [productItem.china_option1, productItem.china_option2]
      .filter(Boolean)
      .join('\n');

    // 동일한 박스번호와 바코드의 기존 항목 찾기
    const existingItemIndex = shipmentData.findIndex(
      item => item.box_number === boxNumber && item.barcode === barcode
    );

    if (existingItemIndex !== -1) {
      // 기존 항목이 있으면 개수 누적
      setShipmentData(prev => prev.map((item, index) => 
        index === existingItemIndex 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      // 새로운 항목 추가
      const newShipmentItem: ShipmentData = {
        id: `${boxNumber}-${barcode}-${Date.now()}`,
        box_number: boxNumber,
        barcode: barcode,
        product_name: productName,
        order_option: orderOption,
        quantity: 1
      };
      
      setShipmentData(prev => [...prev, newShipmentItem]);
    }
  };

  return (
    <div className="export-layout">
      <TopsideMenu />
      <div className="export-main-content">
        <LeftsideMenu />
        <main className="export-content">
          <div className="export-container">
            <h1 className="export-title">상품 출고</h1>
            
            {/* 상단 버튼 영역 */}
            <div className="export-header-buttons">
              <div className="export-left-buttons">
                <button className="export-upload-btn">바코드 스캔</button>
              </div>
              <div className="export-right-buttons">
                <button className="export-download-btn" onClick={saveExportData}>저장</button>
                <button className="export-barcode-btn">바코드 생성</button>
              </div>
            </div>

            {/* 바코드 입력 영역 */}
            <div className="export-barcode-section">
              <div className="export-barcode-board">
                {/* 첫 번째 줄: 드롭박스들 */}
                <div className="export-dropdown-row">
                  <select 
                    className="export-box-dropdown"
                    value={selectedBox}
                    onChange={(e) => setSelectedBox(e.target.value)}
                  >
                    <option value="">박스 선택</option>
                    {Array.from({length: 30}, (_, i) => (
                      <option key={i+1} value={`Box ${i+1}`}>Box {i+1}</option>
                    ))}
                  </select>
                  
                  <select 
                    className="export-size-dropdown"
                    value={selectedSize}
                    onChange={(e) => setSelectedSize(e.target.value)}
                  >
                    <option value="">크기 선택</option>
                    <option value="극소">극소</option>
                    <option value="소">소</option>
                    <option value="중">중</option>
                    <option value="대1">대1</option>
                    <option value="대2">대2</option>
                    <option value="이형">이형</option>
                  </select>
                </div>

                {/* 두 번째 줄: 입력폼과 버튼 */}
                <div className="export-input-row">
                  <input 
                    ref={barcodeInputRef}
                    type="text" 
                    placeholder="바코드를 입력하세요" 
                    className="export-barcode-input"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleScan(e);
                      }
                    }}
                    autoFocus
                  />
                  <input 
                    type="number" 
                    placeholder="개수" 
                    className="export-quantity-input"
                    value={quantityInput}
                    onChange={(e) => setQuantityInput(e.target.value)}
                  />
                  <button className="export-scan-button" onClick={handleScan}>스캔</button>
                </div>
              </div>
            </div>


            {/* 테이블 */}
            <div className="export-table-board">
              <table className="export-table">
                <thead>
                  <tr>
                    <th>이미지</th>
                    <th>글번호</th>
                    <th>상품명</th>
                    <th>주문옵션</th>
                    <th>개수</th>
                    <th>입고</th>
                    <th>확인</th>
                    <th>취소</th>
                    <th>출고</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="export-empty-data">로딩 중...</td></tr>
                  ) : !hasSearched ? (
                    <tr><td colSpan={9} className="export-empty-data">바코드를 스캔해주세요</td></tr>
                  ) : filteredData.length === 0 ? (
                    <tr><td colSpan={9} className="export-empty-data">데이터 없음</td></tr>
                  ) : (
                    filteredData.map((item) => (
                      <tr key={item.id} className={getRowClassName(item)}>
                        <td>
                          {item.img_url ? (
                            <div className="export-image-container">
                              <img 
                                src={item.img_url} 
                                alt="상품 이미지" 
                                className="export-product-thumbnail"
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  img.style.display = 'none';
                                  img.parentElement!.innerHTML = '<div class="export-no-image">이미지 없음</div>';
                                }}
                              />
                            </div>
                          ) : (
                            <div className="export-no-image">이미지 없음</div>
                          )}
                        </td>
                        <td className="export-order-number">{item.order_number}</td>
                        <td className="export-product-name">
                          <div>
                            {item.product_name || '-'}
                            {item.option_name && (
                              <>
                                <br />
                                {item.option_name}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="export-china-options">
                          <div>
                            {item.china_option1 || '-'}
                            {item.china_option2 && (
                              <>
                                <br />
                                {item.china_option2}
                              </>
                            )}
                          </div>
                        </td>
                        <td>{displayNumber(item.ordered_qty)}</td>
                        <td>{displayNumber(item.import_qty)}</td>
                        <td></td>
                        <td>{displayNumber(item.cancel_qty)}</td>
                        <td className="export-qty-cell">
                          {editingExportId === item.id ? (
                            <input
                              type="number"
                              value={editingExportValue}
                              onChange={(e) => setEditingExportValue(e.target.value)}
                              onBlur={() => finishEditExport(item.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') finishEditExport(item.id);
                                if (e.key === 'Escape') cancelEditExport();
                              }}
                              className="export-qty-input"
                              autoFocus
                            />
                          ) : (
                            <span 
                              onClick={() => startEditExport(item)}
                              className="export-qty-value"
                            >
                              {displayNumber(item.export_qty)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 쉽먼트 테이블 */}
            <div className="export-shipment-section">
              <h3 className="export-shipment-title">쉽먼트</h3>
              <div className="export-table-board">
                <table className="export-table">
                  <thead>
                    <tr>
                      <th>박스번호</th>
                      <th>바코드</th>
                      <th>상품명</th>
                      <th>주문옵션</th>
                      <th>개수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipmentData.length === 0 ? (
                      <tr><td colSpan={5} className="export-empty-data">데이터 없음</td></tr>
                    ) : (
                      shipmentData.map((item) => (
                        <tr key={item.id}>
                          <td>{item.box_number}</td>
                          <td>{item.barcode}</td>
                          <td style={{ whiteSpace: 'pre-line' }}>{item.product_name}</td>
                          <td style={{ whiteSpace: 'pre-line' }}>{item.order_option}</td>
                          <td className="export-qty-cell">
                            {editingShipmentId === item.id ? (
                              <input
                                type="number"
                                value={editingShipmentValue}
                                onChange={(e) => setEditingShipmentValue(e.target.value)}
                                onBlur={() => finishEditShipment(item.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') finishEditShipment(item.id);
                                  if (e.key === 'Escape') cancelEditShipment();
                                }}
                                className="export-qty-input"
                                autoFocus
                              />
                            ) : (
                              <span 
                                onClick={() => startEditShipment(item)}
                                className="export-qty-value"
                              >
                                {item.quantity}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* 알림 모달 */}
      {showAlert && (
        <div className="export-alert-modal">
          <div className="export-alert-content">
            {alertMessage}
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {showToast && (
        <div className="export-toast-notification">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default ExportProduct;