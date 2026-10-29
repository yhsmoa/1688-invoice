'use client';

import React, { useState, useRef, useMemo } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import GoogleSheetModal from '../../../component/GoogleSheetModal';
import LocationMoveModal from '../../../component/LocationMoveModal';
import ShipmentLoadModal from './components/ShipmentLoadModal';
import { loadShipmentRows, isUnknownCategory, type VenderPick } from './utils/loadShipmentRows';
import type { CustomsDocumentData } from './types';
import './customs-document.css';

const CustomsDocument: React.FC = () => {
  // orderData = 지금 목록 전체 (엑셀 다운 대상) · filteredData = 검색어로 거른 화면 표시분
  const [orderData, setOrderData] = useState<CustomsDocumentData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [viewMode, setViewMode] = useState<string>('상품별');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showGoogleSheetModal, setShowGoogleSheetModal] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [showLocationMoveModal, setShowLocationMoveModal] = useState(false);
  const [currentMoveLocation, setCurrentMoveLocation] = useState<string>('');
  const [isExcelDownloading, setIsExcelDownloading] = useState(false);

  // [불러오기] — 쉽먼트 V2 출고준비 목록(사업자별) → 통관서류 행
  const [showShipmentLoadModal, setShowShipmentLoadModal] = useState(false);
  const [isShipmentLoading, setIsShipmentLoading] = useState(false);

  // 택배사 정리 모달 관련 상태
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [deliveryExcelFile, setDeliveryExcelFile] = useState<File | null>(null);
  const [isProcessingDelivery, setIsProcessingDelivery] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const deliveryFileInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // 검색 — 지금 목록에서 상품명·옵션·바코드·주문번호·위치·품목으로 거른다 (빈 검색 = 전체)
  //   예전 검색은 결과를 비워 버려 넣어 둔 데이터가 사라졌다 (2026-10-29 교체)
  // ============================================================
  const filteredData = useMemo(() => {
    const term = appliedSearch.toLowerCase();
    if (!term) return orderData;
    return orderData.filter((item) =>
      [item.product_name, item.option_name, item.barcode, item.order_number, item.location, item.item_category]
        .some((v) => (v || '').toLowerCase().includes(term))
    );
  }, [orderData, appliedSearch]);

  // 위치별로 데이터 그룹화
  const groupedDataByLocation = filteredData.reduce((acc, item) => {
    const location = item.location || '미지정';
    if (!acc[location]) {
      acc[location] = [];
    }
    acc[location].push(item);
    return acc;
  }, {} as Record<string, CustomsDocumentData[]>);

  // 품목별 그룹화 처리 (위치별 내에서 품목+혼용률로 합산)
  const processDataByViewMode = (items: CustomsDocumentData[]) => {
    if (viewMode === '품목별') {
      // 품목 + 혼용률 조합으로 그룹화
      const grouped = items.reduce((acc, item) => {
        const key = `${item.item_category || ''}_${item.blend_ratio || ''}`;
        if (!acc[key]) {
          acc[key] = {
            ...item,
            out_quantity: '0',
            in_quantity: '0',
            items: []
          };
        }
        // 출고개수와 입고개수 합산
        const currentOut = parseInt(acc[key].out_quantity || '0');
        const currentIn = parseInt(acc[key].in_quantity || '0');
        const addOut = parseInt(item.out_quantity || '0');
        const addIn = parseInt(item.in_quantity || '0');

        acc[key].out_quantity = (currentOut + addOut).toString();
        acc[key].in_quantity = (currentIn + addIn).toString();
        acc[key].items.push(item);

        return acc;
      }, {} as Record<string, CustomsDocumentData & { items: CustomsDocumentData[] }>);

      return Object.values(grouped);
    }
    return items;
  };

  const performSearch = () => {
    setAppliedSearch(searchTerm.trim());
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleSearchClick = () => {
    performSearch();
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  const handleViewModeChange = (mode: string) => {
    setViewMode(mode);
  };

  const handleSelectAll = (checked: boolean, location: string) => {
    if (checked) {
      const locationData = groupedDataByLocation[location] || [];
      const newSelected = new Set(selectedRows);
      locationData.forEach(item => newSelected.add(item.id));
      setSelectedRows(newSelected);
    } else {
      const locationData = groupedDataByLocation[location] || [];
      const newSelected = new Set(selectedRows);
      locationData.forEach(item => newSelected.delete(item.id));
      setSelectedRows(newSelected);
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedRows(newSelected);
  };


  const handleCopyToClipboard = (text: string, fieldName: string) => {
    if (!text || !text.trim()) return;

    // navigator.clipboard이 없는 경우 fallback
    if (!navigator.clipboard) {
      console.error('클립보드 API를 사용할 수 없습니다.');
      return;
    }

    navigator.clipboard.writeText(text).then(() => {
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 1500);
    }).catch(err => {
      console.error('복사 실패:', err);
    });
  };

  const handleExcelDownload = async () => {
    if (orderData.length === 0) {
      alert('내려받을 데이터가 없습니다. [불러오기] 또는 [구글 시트 등록]으로 먼저 넣어주세요.');
      return;
    }
    setIsExcelDownloading(true);
    try {
      const response = await fetch('/api/export-customs-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: orderData
        }),
      });

      if (!response.ok) {
        throw new Error('엑셀 다운로드 실패');
      }

      // Blob으로 변환
      const blob = await response.blob();

      // 다운로드 링크 생성
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `통관서류_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsExcelDownloading(false);
    }
  };

  // 택배사 정리 모달 열기
  const handleDeliveryModalOpen = () => {
    setShowDeliveryModal(true);
    setDeliveryExcelFile(null);
    if (deliveryFileInputRef.current) {
      deliveryFileInputRef.current.value = '';
    }
  };

  // 택배사 정리 모달 닫기
  const handleDeliveryModalClose = () => {
    setShowDeliveryModal(false);
    setDeliveryExcelFile(null);
    if (deliveryFileInputRef.current) {
      deliveryFileInputRef.current.value = '';
    }
  };

  // 택배사 정리 엑셀 파일 선택
  const handleDeliveryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndSetDeliveryFile(file);
      e.target.value = '';
    }
  };

  // 파일 유효성 검사 및 설정
  const validateAndSetDeliveryFile = (file: File) => {
    const validExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(fileExtension)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }
    setDeliveryExcelFile(file);
  };

  // 드래그앤드롭 핸들러
  const handleDeliveryDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDeliveryDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDeliveryDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndSetDeliveryFile(file);
    }
  };

  // 택배사 정리 엑셀 다운로드
  const handleDeliveryExcelDownload = async () => {
    if (!deliveryExcelFile) {
      alert('엑셀 파일을 먼저 업로드해주세요.');
      return;
    }

    setIsProcessingDelivery(true);
    try {
      const formData = new FormData();
      formData.append('file', deliveryExcelFile);

      const response = await fetch('/api/process-delivery-excel', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '처리 중 오류가 발생했습니다.');
      }

      // Blob으로 변환하여 다운로드
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `택배사정리_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // 성공 후 모달 닫기
      handleDeliveryModalClose();

    } catch (error) {
      console.error('택배사 정리 처리 오류:', error);
      alert(error instanceof Error ? error.message : '택배사 정리 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessingDelivery(false);
    }
  };

  // ============================================================
  // [불러오기] — 고른 사업자의 쉽먼트 V2 출고준비 목록을 통관서류 행으로 (지금 목록을 바꾼다)
  //   품목 '알 수 없음' 이 있으면 구글 시트 등록과 같이 막는다 → 쉽먼트 V2 에서 품목을 고친 뒤 다시
  // ============================================================
  const handleShipmentLoad = async (picks: VenderPick[]) => {
    setIsShipmentLoading(true);
    try {
      const loaded = await loadShipmentRows(picks);
      if (loaded.rows.length === 0) {
        alert('선택한 사업자의 쉽먼트 V2 출고준비 상품이 없습니다.');
        return;
      }
      if (loaded.unknownRows.length > 0) {
        const sample = loaded.unknownRows.slice(0, 10)
          .map(r => `· ${r.location} ${r.barcode || r.order_number} ${r.product_name}`).join('\n');
        alert(`"알 수 없음" 품목이 ${loaded.unknownRows.length}건 있어 불러오지 않았습니다.\n쉽먼트 V2에서 품목을 고친 뒤 다시 불러와 주세요.\n\n${sample}${loaded.unknownRows.length > 10 ? '\n…' : ''}`);
        return;
      }
      if (orderData.length > 0 &&
          !window.confirm(`지금 목록 ${orderData.length}건을 지우고 불러온 ${loaded.rows.length}건으로 바꿀까요?`)) {
        return;
      }

      setOrderData(loaded.rows);
      setSelectedRows(new Set());
      setSearchTerm('');
      setAppliedSearch('');
      setShowShipmentLoadModal(false);

      const boxes = new Set(loaded.rows.map(r => r.location)).size;
      const notes: string[] = [];
      if (loaded.sizeMissingBoxes.length) notes.push(`상자 사이즈 없는 상자 ${loaded.sizeMissingBoxes.length}개 (엑셀 CBM 칸이 비어요): ${loaded.sizeMissingBoxes.slice(0, 5).join(', ')}${loaded.sizeMissingBoxes.length > 5 ? ' …' : ''}`);
      if (loaded.emptyVenders.length) notes.push(`출고준비 상품이 없는 사업자: ${loaded.emptyVenders.join(', ')}`);
      if (loaded.emptyCategory) notes.push(`품목이 비어 있는 상품 ${loaded.emptyCategory}건 (엑셀 영문품명·HS CODE 가 비어요)`);
      alert(`${picks.map(p => p.venderName).join(' · ')} — 상자 ${boxes}개 · 상품 ${loaded.rows.length}건을 불러왔습니다.`
        + (notes.length ? `\n\n⚠ ${notes.join('\n⚠ ')}` : ''));
    } catch (error) {
      console.error('쉽먼트 불러오기 오류:', error);
      alert(`쉽먼트를 불러오지 못했습니다.\n${(error as Error).message}`);
    } finally {
      setIsShipmentLoading(false);
    }
  };

  const handleGoogleSheetOpen = () => {
    setShowGoogleSheetModal(true);
  };

  const handleGoogleSheetSave = () => {
    if (!pasteData.trim()) {
      alert('데이터를 붙여넣기 해주세요.');
      return;
    }

    try {
      // 탭 구분자로 행과 열 파싱
      const rows = pasteData.trim().split('\n');
      const parsedData: CustomsDocumentData[] = rows
        .filter(row => {
          const columns = row.split('\t');
          // 첫번째 열이 '위치'이면 헤더 행이므로 제외
          return columns[0] !== '위치';
        })
        .map((row, index) => {
          const columns = row.split('\t');
          return {
            id: `sheet-${Date.now()}-${index}`,
            location: columns[0] || '',
            order_number: columns[1] || '',
            barcode: columns[2] || '',
            product_name: columns[3] || '',
            option_name: columns[4] || '',
            out_quantity: columns[5] || '',
            in_quantity: columns[6] || '',
            note: columns[7] || '',
            unit_price: columns[8] || '',
            image: columns[9] || '',
            item_category: columns[10] || '',
            blend_ratio: columns[11] || '',
          };
        });

      // '알 수 없음' 품목 검증
      const unknownItems = parsedData.filter(item => isUnknownCategory(item.item_category));
      if (unknownItems.length > 0) {
        alert(`"알 수 없음" 품목이 ${unknownItems.length}건 존재합니다. 확인해주세요.`);
        return;
      }

      // 기존 데이터에 추가
      setOrderData(prev => [...prev, ...parsedData]);

      // 모달 닫기 및 데이터 초기화
      setPasteData('');
      setShowGoogleSheetModal(false);

      alert(`${parsedData.length}건의 데이터가 추가되었습니다.`);
    } catch (error) {
      console.error('데이터 파싱 오류:', error);
      alert('데이터 형식이 올바르지 않습니다.');
    }
  };

  // 이동 버튼 클릭 핸들러
  const handleMoveClick = (location: string) => {
    // 해당 위치의 체크된 항목이 있는지 확인
    const locationItems = groupedDataByLocation[location] || [];
    const hasCheckedItems = locationItems.some(item => selectedRows.has(item.id));

    if (!hasCheckedItems) {
      alert('이동할 항목을 선택해주세요.');
      return;
    }

    setCurrentMoveLocation(location);
    setShowLocationMoveModal(true);
  };

  // 위치 이동 실행
  const handleLocationMove = (newLocation: string) => {
    // 현재 위치에서 체크된 항목들 찾기
    const itemsToMove = filteredData.filter(
      item => item.location === currentMoveLocation && selectedRows.has(item.id)
    );
    const moveIds = new Set(itemsToMove.map(item => item.id));
    // 옮겨 간 상자의 사이즈 — 엑셀 CBM 은 상자(위치) 단위라 옮긴 행도 그 상자 사이즈를 따른다
    const destSize = orderData.find(item => item.location === newLocation && !moveIds.has(item.id))?.box_size || '';

    // 위치 변경 (검색으로 가려진 행도 잃지 않도록 전체 목록에서)
    setOrderData(prev => prev.map(item =>
      moveIds.has(item.id) ? { ...item, location: newLocation, box_size: destSize } : item
    ));

    // 체크 해제
    const newSelected = new Set(selectedRows);
    itemsToMove.forEach(item => newSelected.delete(item.id));
    setSelectedRows(newSelected);

    alert(`${itemsToMove.length}개 항목이 "${newLocation}"(으)로 이동되었습니다.`);
  };

  // 사용 가능한 위치 목록
  const availableLocations = Object.keys(groupedDataByLocation);

  return (
    <div className="customs-document-layout">
      <TopsideMenu />
      <div className="customs-document-main-content">
        <LeftsideMenu />
        <main className="customs-document-content">
          <div className="customs-document-container">
            <h1 className="customs-document-title">통관서류 작성</h1>

            <div className="customs-document-control-section">
              <div className="customs-document-left-controls"></div>
              <div className="customs-document-right-controls">
                <button
                  className="customs-document-load-btn"
                  onClick={() => setShowShipmentLoadModal(true)}
                  title="쉽먼트 V2 의 지금 출고준비 목록을 사업자별로 불러옵니다"
                >
                  불러오기
                </button>
                <button className="customs-document-google-sheet-btn" onClick={handleGoogleSheetOpen}>
                  구글 시트 등록
                </button>
                <button
                  className="customs-document-excel-download-btn"
                  onClick={handleExcelDownload}
                  disabled={isExcelDownloading}
                  style={{ position: 'relative' }}
                >
                  {isExcelDownloading ? (
                    <>
                      <span style={{ marginRight: '8px' }}>다운로드 중...</span>
                      <span className="spinner"></span>
                    </>
                  ) : (
                    '↓ 엑셀 다운'
                  )}
                </button>
                <button
                  className="customs-document-delivery-btn"
                  onClick={handleDeliveryModalOpen}
                >
                  택배사 정리
                </button>
              </div>
            </div>

            <div className="customs-document-section">
              <div className="customs-document-board">
                <div className="customs-document-view-mode-container">
                  <div className="customs-document-radio-group">
                    <label className="customs-document-radio-label">
                      <input
                        type="radio"
                        name="customs-document-viewMode"
                        value="상품별"
                        checked={viewMode === '상품별'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="customs-document-radio-input"
                      />
                      상품별
                    </label>
                    <label className="customs-document-radio-label">
                      <input
                        type="radio"
                        name="customs-document-viewMode"
                        value="품목별"
                        checked={viewMode === '품목별'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="customs-document-radio-input"
                      />
                      품목별
                    </label>
                  </div>
                </div>

                <div className="customs-document-form-container">
                  <input
                    type="text"
                    placeholder="상품명, 옵션 등으로 검색하세요..."
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                    className="customs-document-input"
                  />
                  <button onClick={handleSearchClick} className="customs-document-button">
                    검색
                  </button>
                </div>
              </div>
            </div>

            {filteredData.length === 0 ? (
              <div className="customs-document-empty-data">
                {orderData.length === 0 ? '[불러오기] 또는 [구글 시트 등록]으로 데이터를 넣어주세요.' : '검색 결과가 없습니다.'}
              </div>
            ) : (
              Object.entries(groupedDataByLocation).map(([location, items]) => {
                const processedItems = processDataByViewMode(items);
                const isAllLocationSelected = processedItems.every(item => selectedRows.has(item.id));

                return (
                  <div key={location} className="customs-document-location-section">
                    <div className="customs-document-location-info">
                      <div className="customs-document-location-left">
                        <h3 className="customs-document-location-title">위치: {location}</h3>
                        {items.find(item => item.box_size) && (
                          <span className="customs-document-location-size">{items.find(item => item.box_size)?.box_size}</span>
                        )}
                        <span className="customs-document-location-count">
                          {viewMode === '품목별' ? `(${processedItems.length}개 품목)` : `(${items.length}건)`}
                        </span>
                      </div>
                      {viewMode === '상품별' && (
                        <button
                          className="customs-document-location-move-btn"
                          onClick={() => handleMoveClick(location)}
                        >
                          이동
                        </button>
                      )}
                    </div>
                    <div className="customs-document-table-board">
                      <table className="customs-document-table">
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                checked={isAllLocationSelected}
                                onChange={(e) => handleSelectAll(e.target.checked, location)}
                                className="customs-document-table-checkbox"
                              />
                            </th>
                            <th>이미지</th>
                            <th>위치</th>
                            <th>주문번호 & 바코드</th>
                            <th>상품명</th>
                            <th>옵션명</th>
                            <th>출고개수</th>
                            <th>입고개수</th>
                            <th>단가</th>
                            <th>품목</th>
                            <th>혼용률</th>
                          </tr>
                        </thead>
                        <tbody>
                          {processedItems.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedRows.has(item.id)}
                                  onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                                  className="customs-document-table-checkbox"
                                />
                              </td>
                              <td className="customs-document-image-cell">
                                {item.image && (
                                  <img
                                    src={`/api/image-proxy?url=${encodeURIComponent(item.image)}`}
                                    alt="상품 이미지"
                                    className="customs-document-product-thumbnail"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                                    }}
                                  />
                                )}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.location || '', '위치')}
                                title="클릭하여 복사"
                              >
                                {item.location || ''}
                              </td>
                              <td
                                className="customs-document-cell customs-document-order-barcode-cell"
                                onClick={() => handleCopyToClipboard(`${item.order_number || ''}\n${item.barcode || ''}`, '주문번호 & 바코드')}
                                title="클릭하여 복사"
                              >
                                <div className="customs-document-order-number">{item.order_number || ''}</div>
                                <div className="customs-document-barcode">{item.barcode || ''}</div>
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.product_name || '', '상품명')}
                                title="클릭하여 복사"
                              >
                                {item.product_name || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.option_name || '', '옵션명')}
                                title="클릭하여 복사"
                              >
                                {item.option_name || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.out_quantity || '', '출고개수')}
                                title="클릭하여 복사"
                              >
                                {item.out_quantity || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.in_quantity || '', '입고개수')}
                                title="클릭하여 복사"
                              >
                                {item.in_quantity || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.unit_price || '', '단가')}
                                title="클릭하여 복사"
                              >
                                {item.unit_price || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.item_category || '', '품목')}
                                title="클릭하여 복사"
                              >
                                {item.item_category || ''}
                              </td>
                              <td
                                className="customs-document-cell"
                                onClick={() => handleCopyToClipboard(item.blend_ratio || '', '혼용률')}
                                title="클릭하여 복사"
                              >
                                {item.blend_ratio || ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      </div>

      {showCopyToast && (
        <div className="customs-document-copy-toast">
          복사되었습니다!
        </div>
      )}

      <GoogleSheetModal
        isOpen={showGoogleSheetModal}
        onClose={() => setShowGoogleSheetModal(false)}
        onSave={handleGoogleSheetSave}
        pasteData={pasteData}
        setPasteData={setPasteData}
      />

      <ShipmentLoadModal
        isOpen={showShipmentLoadModal}
        loading={isShipmentLoading}
        onClose={() => setShowShipmentLoadModal(false)}
        onLoad={handleShipmentLoad}
      />

      <LocationMoveModal
        isOpen={showLocationMoveModal}
        onClose={() => setShowLocationMoveModal(false)}
        currentLocation={currentMoveLocation}
        availableLocations={availableLocations}
        onMove={handleLocationMove}
      />

      {/* 택배사 정리 모달 */}
      {showDeliveryModal && (
        <div className="delivery-modal-overlay" onClick={handleDeliveryModalClose}>
          <div className="delivery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delivery-modal-header">
              <h2 className="delivery-modal-title">택배사 정리</h2>
              <button className="delivery-modal-close-btn" onClick={handleDeliveryModalClose}>
                닫기
              </button>
            </div>

            <div className="delivery-modal-content">
              <div
                className={`delivery-upload-box ${isDragging ? 'drag-over' : ''}`}
                onClick={() => deliveryFileInputRef.current?.click()}
                onDragOver={handleDeliveryDragOver}
                onDragLeave={handleDeliveryDragLeave}
                onDrop={handleDeliveryDrop}
              >
                <input
                  ref={deliveryFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleDeliveryFileSelect}
                  style={{ display: 'none' }}
                />
                <div className="delivery-upload-icon">
                  {deliveryExcelFile ? '✅' : '📁'}
                </div>
                <div className="delivery-upload-text">
                  {deliveryExcelFile ? deliveryExcelFile.name : '클릭하여 엑셀 파일을 선택하세요'}
                </div>
                <div className="delivery-upload-hint">
                  {deliveryExcelFile ? '다른 파일을 선택하려면 클릭하세요' : '클릭 또는 드래그앤드롭으로 파일을 업로드하세요'}
                </div>
              </div>

              <button
                className={`delivery-download-btn ${deliveryExcelFile ? 'active' : ''}`}
                onClick={handleDeliveryExcelDownload}
                disabled={!deliveryExcelFile || isProcessingDelivery}
              >
                {isProcessingDelivery ? (
                  <>
                    <span style={{ marginRight: '8px' }}>처리 중...</span>
                    <span className="spinner"></span>
                  </>
                ) : (
                  '택배사 정리 엑셀 다운로드'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomsDocument;
