'use client';

import React, { useState, useMemo } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import GoogleSheetModal from '../../../component/GoogleSheetModal';
import LocationMoveModal from '../../../component/LocationMoveModal';
import ShipmentLoadModal from './components/ShipmentLoadModal';
import DeliveryModal from './components/DeliveryModal';
import CustomsTable, { type CustomsBoxGroup, type CustomsViewMode } from './components/CustomsTable';
import { loadShipmentRows, isUnknownCategory, type VenderPick } from './utils/loadShipmentRows';
import { customsItemKey } from '../../../lib/customsItemKey';
import type { CustomsDocumentData } from './types';
// 쉽먼트 V2 와 같은 디자인(sv2-* · 색 토큰)을 쓴다 — 이 화면만의 보조 규칙은 customs-document.css
import '../../shipment-v2/ShipmentV2.css';
import './customs-document.css';

const CustomsDocument: React.FC = () => {
  // orderData = 지금 목록 전체 (엑셀 다운 대상) · filteredData = 검색어로 거른 화면 표시분
  const [orderData, setOrderData] = useState<CustomsDocumentData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [viewMode, setViewMode] = useState<CustomsViewMode>('상품별');
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

  // 택배사 정리 모달 (파일 선택 · 처리 상태는 components/DeliveryModal 안에서)
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

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

  // 품목별 그룹화 처리 (위치별 내에서 품목으로 합산 — 기준은 lib/customsItemKey.ts)
  const processDataByViewMode = (items: CustomsDocumentData[]) => {
    if (viewMode === '품목별') {
      const grouped = items.reduce((acc, item) => {
        const key = customsItemKey(item);
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

  // 표 머리줄 체크박스 — 지금 보이는 행 전체
  const handleSelectAllVisible = (checked: boolean) => {
    const newSelected = new Set(selectedRows);
    filteredData.forEach(item => (checked ? newSelected.add(item.id) : newSelected.delete(item.id)));
    setSelectedRows(newSelected);
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


  const handleCopyToClipboard = (text: string) => {
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

  // ── 표에 넘길 상자 묶음 + 헤더 요약 + 빈 상태 문구 ──
  const boxGroups: CustomsBoxGroup[] = Object.entries(groupedDataByLocation).map(([location, items]) => ({
    location,
    items,
    rows: processDataByViewMode(items),
  }));
  const totalBoxes = new Set(orderData.map(item => item.location || '미지정')).size;
  const emptyMessage = filteredData.length > 0
    ? null
    : orderData.length === 0
      ? '[불러오기] 또는 [구글 시트 등록]으로 데이터를 넣어주세요.'
      : '검색 결과가 없습니다.';

  // ============================================================
  // 렌더 — 쉽먼트 V2 와 같은 틀 (헤더 / 액션 바 / 필터 패널 / 표)
  // ============================================================
  return (
    <div className="shipment-v2-layout">
      <TopsideMenu />
      <div className="shipment-v2-main-content">
        <LeftsideMenu />
        <main className="shipment-v2-content">
          <div className="sv2-page cd-page">

            {/* ── 헤더: 제목 / 상자 · 상품 건수 ── */}
            <header className="sv2-header">
              <div className="sv2-header-title">
                <h1>통관서류 작성</h1>
                <p>쉽먼트 V2 출고준비 목록이나 구글 시트 데이터를 상자별로 모아 통관 엑셀로 내려받습니다</p>
              </div>
              <div className="sv2-header-controls">
                {orderData.length > 0 && (
                  <span className="sv2-total">상자 {totalBoxes}개 · 상품 {orderData.length}건</span>
                )}
              </div>
            </header>

            {/* ── 액션 바: [불러오기 · 구글 시트 등록]  ……  [↓ 엑셀 다운] [택배사 정리] ── */}
            <div className="sv2-toolbar">
              <div className="sv2-toolbar-group">
                <div className="sv2-btn-group">
                  <button
                    className="sv2-btn"
                    onClick={() => setShowShipmentLoadModal(true)}
                    title="쉽먼트 V2 의 지금 출고준비 목록을 사업자별로 불러옵니다"
                  >
                    불러오기
                  </button>
                  <button className="sv2-btn" onClick={handleGoogleSheetOpen}>
                    구글 시트 등록
                  </button>
                </div>
              </div>
              <div className="sv2-toolbar-group">
                <button
                  className="sv2-btn sv2-btn--solo sv2-btn--primary"
                  onClick={handleExcelDownload}
                  disabled={isExcelDownloading}
                >
                  {isExcelDownloading ? (<>다운로드 중... <span className="cd-spinner" /></>) : '↓ 엑셀 다운'}
                </button>
                <button className="sv2-btn sv2-btn--solo" onClick={() => setShowDeliveryModal(true)}>
                  택배사 정리
                </button>
              </div>
            </div>

            {/* ── 필터 패널: 보기 방식 / 검색 ── */}
            <div className="sv2-filters">
              <div className="sv2-filter-row">
                <span className="sv2-filter-label">보기</span>
                {(['상품별', '품목별'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`sv2-chip ${viewMode === mode ? 'is-active' : ''}`}
                    onClick={() => setViewMode(mode)}
                    aria-pressed={viewMode === mode}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="sv2-filters-divider" />
              <div className="sv2-filter-row">
                <span className="sv2-filter-label">검색</span>
                <input
                  type="text"
                  placeholder="상품명, 옵션 등으로 검색하세요..."
                  value={searchTerm}
                  onChange={handleSearchInputChange}
                  onKeyPress={handleSearchKeyPress}
                  className="cd-search-input"
                />
                <button onClick={handleSearchClick} className="sv2-btn sv2-btn--solo sv2-btn--sm">
                  검색
                </button>
              </div>
            </div>

            {/* ── 표 ── */}
            <CustomsTable
              groups={boxGroups}
              viewMode={viewMode}
              selectedRows={selectedRows}
              emptyMessage={emptyMessage}
              onToggleRow={handleSelectRow}
              onToggleLocation={(location, checked) => handleSelectAll(checked, location)}
              onToggleAll={handleSelectAllVisible}
              onMoveClick={handleMoveClick}
              onCopy={handleCopyToClipboard}
            />
          </div>
        </main>
      </div>

      {showCopyToast && (
        <div className="cd-copy-toast" role="status">복사되었습니다!</div>
      )}

      {/* ============================================================ */}
      {/* 모달                                                          */}
      {/* ============================================================ */}
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

      {showDeliveryModal && <DeliveryModal onClose={() => setShowDeliveryModal(false)} />}
    </div>
  );
};

export default CustomsDocument;
