'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';

// ============================================================
// 공유 컴포넌트
// ============================================================
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';

// ============================================================
// V2 전용 CSS
// ============================================================
import './ItemCheck.css';

// ============================================================
// V2 전용 hooks (ft_users / ft_order_items)
// ============================================================
import {
  useFtUsers,
  useFtOrderItems,
  useFtSearch,
  useFtPagination,
  useFtFulfillmentSummary,
  type FtOrderItem,
} from './hooks/useFtData';

// ============================================================
// V2 전용 컴포넌트
// ============================================================
import ItemTable from './components/ItemTable';
import SearchSection from './components/SearchSection';
import V2ReadyModal, { type V2ReadyItem } from './components/V2ReadyModal';
import V2LabelModal from './components/V2LabelModal';

// ============================================================
// 담당자 옵션 + 담당자 → user_id 매핑 (invoice_fashion_label용)
// ============================================================
const OPERATOR_OPTIONS = ['소현', '장뢰', '3'];
const OPERATOR_ID_MAP: Record<string, number> = { '소현': 1, '장뢰': 2, '3': 3 };

const ItemCheck: React.FC = () => {
  // ============================================================
  // 1) ft_users 드롭박스
  // ============================================================
  const { users, loading: usersLoading } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');

  // ============================================================
  // 2) ft_order_items 데이터 (선택된 user_id + PROCESSING)
  // ============================================================
  const { items, loading: itemsLoading, fetchItems } = useFtOrderItems();

  // ============================================================
  // 2-1) 검색 타입 — 기본값: 배송번호 (hook 순서 때문에 여기 선언)
  // ============================================================
  const [searchType, setSearchType] = useState('배송번호');

  // ============================================================
  // 2-2) 배송번호 서버 조회 결과
  //      null = 아직 검색 안 함 → 기본 items 표시
  //      FtOrderItem[] = 검색 완료 → 해당 결과 표시
  // ============================================================
  const [deliveryItems, setDeliveryItems] = useState<FtOrderItem[] | null>(null);
  const [isDeliverySearching, setIsDeliverySearching] = useState(false);

  // activeItems: 배송번호 모드+검색완료 → deliveryItems / 그 외 → items
  const activeItems =
    searchType === '배송번호' && deliveryItems !== null ? deliveryItems : items;

  // ============================================================
  // 3) 검색
  //    - 일반검색: useFtSearch가 activeItems를 client-side 필터
  //    - 배송번호: 서버 조회 결과(deliveryItems)를 그대로 표시
  // ============================================================
  const { searchTerm, setSearchTerm, filteredItems, clearSearch } = useFtSearch(activeItems);

  // ============================================================
  // 4) 페이지네이션
  // ============================================================
  const {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    goToNextPage,
    goToPrevPage,
  } = useFtPagination(filteredItems);

  // ============================================================
  // 4-1) ft_fulfillments ARRIVAL/PACKED/CANCEL/SHIPMENT 합계
  //      activeItems 변경 시 자동 fetch (1회 요청, 타입별 집계)
  // ============================================================
  const { arrivalMap, packedMap, cancelMap, shipmentMap, refreshFulfillments } = useFtFulfillmentSummary(activeItems);

  // ============================================================
  // 5) 담당자 드롭박스 (UI 유지, 현재 단계에서 기능 미연결)
  // ============================================================
  const [selectedOperator, setSelectedOperator] = useState('');

  // 5-1) searchType은 2-1 섹션에서 선언됨 (hook 순서)

  // ============================================================
  // 6) 체크박스 선택 관리
  // ============================================================
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const isAllSelected =
    paginatedData.length > 0 && paginatedData.every((item) => selectedRows.has(item.id));
  const isIndeterminate =
    paginatedData.some((item) => selectedRows.has(item.id)) && !isAllSelected;

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        paginatedData.forEach((item) => {
          if (checked) next.add(item.id);
          else next.delete(item.id);
        });
        return next;
      });
    },
    [paginatedData]
  );

  const handleSelectRow = useCallback((id: string, checked: boolean) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // ============================================================
  // 7) 이미지 미리보기용 마우스 위치
  // ============================================================
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  }, []);

  // ============================================================
  // 8) ft_users 드롭박스 변경 → 자동 데이터 조회 + 배송번호 결과 초기화
  // ============================================================
  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const userId = e.target.value;
      setSelectedUserId(userId);
      setSelectedRows(new Set());
      setModifiedImportQty(new Map());
      setDeliveryItems(null);
      setSearchInput('');
      clearSearch();

      if (userId) {
        fetchItems(userId);
      }
    },
    [fetchItems, clearSearch]
  );

  // ============================================================
  // 9) 검색 핸들러
  //
  // 입력값(searchInput)과 적용값(setSearchTerm)을 분리하여
  // Enter / [검색] 버튼 클릭 시에만 필터/조회 실행
  // ============================================================

  // 9-0) 입력 필드 live 값 (표시용) — setSearchTerm은 적용 시에만 호출
  const [searchInput, setSearchInput] = useState('');

  // 9-1) 배송번호 서버 조회 (delivery_code → order_id → ft_order_items)
  const handleDeliverySearch = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      setIsDeliverySearching(true);
      try {
        const res = await fetch(
          `/api/ft/order-items/by-delivery-code?delivery_code=${encodeURIComponent(trimmed)}`
        );
        const json = await res.json();

        if (json.success) {
          setDeliveryItems(json.data);
          if (json.data.length === 0) {
            alert('해당 배송번호로 조회된 아이템이 없습니다.');
          }
        } else {
          alert(json.error || '배송번호 조회 중 오류가 발생했습니다.');
        }
      } catch {
        alert('배송번호 조회 중 오류가 발생했습니다.');
      } finally {
        setIsDeliverySearching(false);
      }
    },
    []
  );

  // 9-2) 검색 타입 변경 → 입력값·결과 초기화
  const handleSearchTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSearchType(e.target.value);
      setDeliveryItems(null);
      setSearchInput('');
      clearSearch(); // useFtSearch 내부 searchTerm 초기화
    },
    [clearSearch]
  );

  // 9-3) 입력값 변경 → searchInput만 업데이트 (필터 미적용)
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchInput(e.target.value);
    },
    []
  );

  // 9-4) 검색 실행 공통 함수
  const applySearch = useCallback(
    (value: string) => {
      if (searchType === '배송번호') {
        handleDeliverySearch(value);
      } else {
        setSearchTerm(value); // 일반검색: useFtSearch 필터 적용
      }
    },
    [searchType, handleDeliverySearch, setSearchTerm]
  );

  // 9-5) Enter 키 → 검색 실행
  const handleSearchKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applySearch(searchInput);
      }
    },
    [searchInput, applySearch]
  );

  // 9-6) [검색] 버튼 클릭 → 검색 실행
  const handleSearchClick = useCallback(() => {
    applySearch(searchInput);
  }, [searchInput, applySearch]);

  // ============================================================
  // 10) 입고(import_qty) 셀 편집 — V1 useEditCell 방식 동일
  // ============================================================
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [modifiedImportQty, setModifiedImportQty] = useState<Map<string, number>>(new Map());

  // 셀 클릭 → 편집 시작
  const startEditingCell = useCallback(
    (id: string, field: string, value: number | string | null | undefined) => {
      setEditingCell({ id, field });
      setCellValue(value != null && value !== 0 ? String(value) : '');
    },
    []
  );

  // 입력값 변경 (숫자만 허용)
  const handleCellValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const cleaned = e.target.value.replace(/[^0-9]/g, '');
      setCellValue(cleaned);
    },
    []
  );

  // 편집 완료 (blur / Enter)
  const finishEditingCell = useCallback(() => {
    if (!editingCell) return;

    const { id } = editingCell;
    const numValue = cellValue.trim() === '' ? 0 : parseInt(cellValue, 10);

    setModifiedImportQty((prev) => {
      const next = new Map(prev);
      if (numValue > 0) {
        next.set(id, numValue);
      } else {
        next.delete(id);
      }
      return next;
    });

    setEditingCell(null);
    setCellValue('');
  }, [editingCell, cellValue]);

  // 키보드 핸들러 (Enter → 완료, Escape → 취소)
  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEditingCell();
      } else if (e.key === 'Escape') {
        setEditingCell(null);
        setCellValue('');
      }
    },
    [finishEditingCell]
  );

  // ============================================================
  // 11) readyItems — 수정된 입고 데이터 목록
  // ============================================================
  const readyItems: V2ReadyItem[] = useMemo(() => {
    return Array.from(modifiedImportQty.entries())
      .map(([id, qty]) => {
        const item = items.find((i) => i.id === id);
        if (!item) return null;
        return { item, import_qty: qty };
      })
      .filter((v): v is V2ReadyItem => v !== null);
  }, [modifiedImportQty, items]);

  // ============================================================
  // 12) 처리준비 모달
  // ============================================================
  const [isReadyModalOpen, setIsReadyModalOpen] = useState(false);

  // ============================================================
  // 13) 라벨 모달 — 선택된 항목 중 barcode 있는 것만 표시
  // ============================================================
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

  // 라벨 모달에 표시할 항목: 체크된 행 중 barcode가 있는 것
  const labelItems = useMemo(() => {
    return items.filter(
      (item) => selectedRows.has(item.id) && item.barcode
    );
  }, [items, selectedRows]);

  // 선택된 ft_user 객체 (brand 조회용)
  const selectedUser = useMemo(() => {
    return users.find((u) => u.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  // 담당자 → operator_id 변환
  const operatorId = OPERATOR_ID_MAP[selectedOperator] || null;

  // [라벨] 버튼 클릭 핸들러
  const handleLabelClick = useCallback(() => {
    if (selectedRows.size === 0) {
      alert('항목을 선택해주세요.');
      return;
    }
    const withBarcode = items.filter(
      (item) => selectedRows.has(item.id) && item.barcode
    );
    if (withBarcode.length === 0) {
      alert('바코드가 있는 선택된 항목이 없습니다.');
      return;
    }
    setIsLabelModalOpen(true);
  }, [selectedRows, items]);

  // 라벨 저장 완료 콜백
  const handleLabelSaveComplete = useCallback(() => {
    setSelectedRows(new Set());
    refreshFulfillments();
  }, [refreshFulfillments]);

  // ============================================================
  // 14) [저장] 모달 → postgre + 저장 핸들러
  //     동시에 두 가지 처리:
  //     1) invoice_fashion_label 저장 (LABEL postgre 동일 로직)
  //     2) ft_fulfillments 저장 (ARRIVAL)
  // ============================================================
  const handleReadySavePostgre = useCallback(async () => {
    // 필수 값 검증
    if (!selectedOperator) {
      alert('담당자를 선택해주세요.');
      return;
    }
    if (!selectedUserId) {
      alert('사용자를 선택해주세요.');
      return;
    }

    const currentOperatorId = OPERATOR_ID_MAP[selectedOperator] || null;
    const currentUser = users.find((u) => u.id === selectedUserId) || null;

    try {
      // ── 1) invoice_fashion_label 저장 데이터 구성 ──
      const labelItems = readyItems
        .filter(({ item }) => item.barcode)
        .map(({ item, import_qty }) => ({
          brand: currentUser?.brand || null,
          item_name: item.item_name || '',
          barcode: item.barcode || '',
          qty: import_qty,
          order_no: item.item_no || '',
          composition: item.composition || null,
          recommanded_age: item.recommanded_age || null,
          shipment_size: item.coupang_shipment_size || null,
          user_id: currentOperatorId,
        }));

      // ── 2) ft_fulfillments 저장 데이터 구성 ──
      const fulfillmentItems = readyItems.map(({ item, import_qty }) => ({
        order_item_id: item.id,
        type: 'ARRIVAL',
        quantity: import_qty,
        operator_name: selectedOperator,
        order_no: item.order_no || null,
        item_no: item.item_no || null,
        user_id: selectedUserId,
      }));

      // ── 3) 두 API 동시 호출 ──
      const promises: Promise<Response>[] = [];

      // 3-1) invoice_fashion_label (바코드 있는 항목만)
      if (labelItems.length > 0) {
        promises.push(
          fetch('/api/save-fashion-label', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: labelItems, user_id: currentOperatorId }),
          })
        );
      }

      // 3-2) ft_fulfillments (모든 항목)
      promises.push(
        fetch('/api/ft/fulfillments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: fulfillmentItems }),
        })
      );

      const responses = await Promise.all(promises);

      // ── 4) 응답 확인 ──
      for (const res of responses) {
        const result = await res.json();
        if (!res.ok || !result.success) {
          throw new Error(result.error || '저장 실패');
        }
      }

      // ── 5) 성공 → 상태 초기화 + 모달 닫기 + 테이블 갱신 ──
      alert('PostgreSQL 저장이 완료되었습니다.');
      setModifiedImportQty(new Map());
      setSelectedRows(new Set());
      setIsReadyModalOpen(false);
      refreshFulfillments();

    } catch (error) {
      console.error('postgre + 저장 오류:', error);
      alert(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
    }
  }, [readyItems, selectedOperator, selectedUserId, users, refreshFulfillments]);

  // ============================================================
  // 15) 1688 xlsx 업로드
  // ============================================================
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);

  const handleXlsxClick = useCallback(() => {
    excelFileInputRef.current?.click();
  }, []);

  const handleXlsxFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
        return;
      }

      setIsUploadingExcel(true);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/upload-delivery-excel', {
          method: 'POST',
          body: formData,
        });
        const result = await response.json();

        if (response.ok) {
          alert(`엑셀 파일이 성공적으로 업로드되었습니다.\n저장된 데이터: ${result.count || 0}개`);
        } else {
          alert(result.error || '업로드 중 오류가 발생했습니다.');
        }
      } catch {
        alert('업로드 중 오류가 발생했습니다.');
      } finally {
        setIsUploadingExcel(false);
        if (excelFileInputRef.current) excelFileInputRef.current.value = '';
      }
    },
    []
  );

  // ============================================================
  // 로딩 상태
  // ============================================================
  const loading = usersLoading || itemsLoading;

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="v2-item-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="v2-item-main-content">
        <LeftsideMenu />
        <main className="v2-item-content">
          <div className="v2-item-container">
            <h1 className="v2-item-title">상품입고 V2</h1>

            {/* ============================================================ */}
            {/* 컨트롤 바: 왼쪽(드롭박스+버튼) / 오른쪽(액션 버튼) */}
            {/* ============================================================ */}
            <div className="v2-excel-upload-section">
              <div className="v2-control-left">
                {/* 담당자 선택 (UI 유지) */}
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedOperator}
                  onChange={(e) => setSelectedOperator(e.target.value)}
                >
                  <option value="">담당자 선택</option>
                  {OPERATOR_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>

                {/* ft_users 선택 → 자동 데이터 조회 */}
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                >
                  <option value="">사용자 선택</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>

                {/* 새로고침 버튼 */}
                <button
                  className="v2-excel-upload-btn"
                  onClick={() => selectedUserId && fetchItems(selectedUserId)}
                  disabled={loading || !selectedUserId}
                >
                  {itemsLoading ? (
                    <span className="v2-button-loading">
                      <span className="v2-spinner"></span>
                      새로고침
                    </span>
                  ) : (
                    '새로고침'
                  )}
                </button>

                {/* 1688 xlsx 버튼 */}
                <button
                  className="v2-excel-upload-btn"
                  onClick={handleXlsxClick}
                  disabled={isUploadingExcel}
                >
                  {isUploadingExcel ? (
                    <span className="v2-button-loading">
                      <span className="v2-spinner"></span>
                      업로드 중
                    </span>
                  ) : (
                    '1688 xlsx'
                  )}
                </button>
                <input
                  ref={excelFileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleXlsxFileChange}
                />
              </div>

              <div className="v2-control-right">
                {/* 미입고 버튼 */}
                <button className="v2-excel-upload-btn">미입고</button>

                {/* 라벨 버튼 */}
                <button className="v2-excel-upload-btn" onClick={handleLabelClick}>라벨</button>

                {/* 입고 버튼 (작업 수량 입력된 개수 표시) */}
                <button
                  className={`v2-excel-upload-btn ${readyItems.length > 0 ? 'has-items' : ''}`}
                  onClick={() => setIsReadyModalOpen(true)}
                >
                  입고{readyItems.length > 0 && ` (${readyItems.length})`}
                </button>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 검색 영역 */}
            {/* ============================================================ */}
            <SearchSection
              searchType={searchType}
              searchTerm={searchInput}
              onSearchTypeChange={handleSearchTypeChange}
              onSearchInputChange={handleSearchInputChange}
              onSearchKeyPress={handleSearchKeyPress}
              onSearchClick={handleSearchClick}
              isSearching={isDeliverySearching}
            />

            {/* ============================================================ */}
            {/* 데이터 테이블 */}
            {/* ============================================================ */}
            <ItemTable
              loading={loading}
              paginatedData={paginatedData}
              selectedRows={selectedRows}
              mousePosition={mousePosition}
              isAllSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              editingCell={editingCell}
              cellValue={cellValue}
              modifiedImportQty={modifiedImportQty}
              arrivalMap={arrivalMap}
              packedMap={packedMap}
              cancelMap={cancelMap}
              shipmentMap={shipmentMap}
              onSelectAll={handleSelectAll}
              onSelectRow={handleSelectRow}
              onStartEditingCell={startEditingCell}
              onCellValueChange={handleCellValueChange}
              onCellKeyDown={handleCellKeyDown}
              onFinishEditingCell={finishEditingCell}
            />

            {/* ============================================================ */}
            {/* 페이지네이션 */}
            {/* ============================================================ */}
            {!loading && filteredItems.length > 0 && (
              <div className="v2-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="v2-pagination-button"
                >
                  이전
                </button>

                <div className="v2-page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`v2-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="v2-pagination-button"
                >
                  다음
                </button>

                <span className="v2-page-info">
                  {currentPage} / {totalPages} 페이지 (총 {filteredItems.length}개)
                </span>
              </div>
            )}

            {/* 데이터 없음 안내 */}
            {!loading && selectedUserId && items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                해당 사용자의 PROCESSING 상태 주문이 없습니다.
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 처리준비 모달 */}
      {/* ============================================================ */}
      <V2ReadyModal
        isOpen={isReadyModalOpen}
        onClose={() => setIsReadyModalOpen(false)}
        readyItems={readyItems}
        onSavePostgre={handleReadySavePostgre}
      />

      {/* ============================================================ */}
      {/* 라벨 모달 — LABEL postgre 저장 */}
      {/* ============================================================ */}
      <V2LabelModal
        isOpen={isLabelModalOpen}
        onClose={() => setIsLabelModalOpen(false)}
        items={labelItems}
        selectedUser={selectedUser}
        operatorId={operatorId}
        modifiedImportQty={modifiedImportQty}
        onSaveComplete={handleLabelSaveComplete}
      />
    </div>
  );
};

export default ItemCheck;
