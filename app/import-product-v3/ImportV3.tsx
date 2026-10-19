'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// 공유 컴포넌트
// ============================================================
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';

// ============================================================
// CSS — 레이아웃·검색·드롭박스·배지는 V2 스타일을 그대로 쓴다
// ============================================================
import '../import-product-v2/ItemCheck.css';
import './ImportV3.css';

// ============================================================
// V2 공용 hooks / 컴포넌트 (동작 동일 — 데이터·운송장·부가 모달)
//   업로드·다운로드 버튼([V2 이전] [1688 XLSX] [배송상황 csv] [XLSX 다운] [주문 ID])은
//   입고 화면에선 쓰지 않아 /order-status-v2 로 옮겼다.
// ============================================================
import {
  useFtUsers,
  useFtOrderItems,
  useFtSearch,
  useFtFulfillmentSummary,
  type FtOrderItem,
} from '../import-product-v2/hooks/useFtData';
import { useWorkers, PC_NO_OPTIONS } from '../import-product-v2/hooks/useWorkers';
import { usePersonalInvoicePrint } from '../import-product-v2/hooks/usePersonalInvoicePrint';
import SearchSection from '../import-product-v2/components/SearchSection';
import V2CancelModal from '../import-product-v2/components/V2CancelModal';
import V2NoteModal from '../import-product-v2/components/V2NoteModal';
import V2CustomerConfirmModal from '../import-product-v2/components/V2CustomerConfirmModal';
import FulfillmentLogModal from '../import-product-v2/components/FulfillmentLogModal';

// ============================================================
// V3 전용
// ============================================================
import BoardGrid from './components/BoardGrid';
import CardModal from './components/CardModal';
import { useCardGroups } from './hooks/useCardGroups';
import { useSetSiblings } from './hooks/useSetSiblings';
import { useInboundActions } from './hooks/useInboundActions';

// ============================================================
// 상품입고 V3 — 색상 카드 + 옵션 일괄 배분 입고
//
//   검색 → (오퍼 + 색상) 카드, 세트는 하나의 보드로 묶어 표시
//   보드 클릭 → 대형 모달(CardModal) 에서 옵션별 개수 입력 → 주문행 순서대로 배분
//   저장·라벨·운송장·반품·비고·고객확인은 V2 와 같은 API / 컴포넌트를 쓴다.
//   설계 문서: docs/PLAN_import-product-v3.md
// ============================================================

type StatusFilter = 'PROCESSING' | 'ALL';

const EMPTY_ITEMS: FtOrderItem[] = [];

const ImportV3: React.FC = () => {
  const { t } = useTranslation();

  // ============================================================
  // 1) 사용자 · 주문 항목 · 상태 필터
  // ============================================================
  const { users, loading: usersLoading } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');
  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) || null, [users, selectedUserId]);

  const { items, loading: itemsLoading, fetchItems } = useFtOrderItems();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PROCESSING');

  // ============================================================
  // 2) 검색 — 배송번호는 서버 조회, 그 외는 클라이언트 필터 (V2 와 동일)
  //    카드는 "검색한 뒤" 에만 보여준다. [전체 보기] 를 체크하면 전체 항목을 카드로.
  // ============================================================
  const [searchType, setSearchType] = useState('배송번호');
  const [searchInput, setSearchInput] = useState('');
  const [deliveryItems, setDeliveryItems] = useState<FtOrderItem[] | null>(null);
  const [lastDeliveryCode, setLastDeliveryCode] = useState('');
  const [isDeliverySearching, setIsDeliverySearching] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const activeItems = searchType === '배송번호' && deliveryItems !== null ? deliveryItems : items;
  const { searchTerm, setSearchTerm, filteredItems, clearSearch } = useFtSearch(activeItems, searchType);

  const hasSearched = searchType === '배송번호' ? deliveryItems !== null : searchTerm.trim() !== '';
  const displayItems = hasSearched || showAll ? filteredItems : EMPTY_ITEMS;

  // ============================================================
  // 3) 세트 형제 행 + 입고/취소/포장/출고 합계
  //    합계 조회 범위 = 검색 결과 ∪ 형제 행 (세트 스티커 계산에 형제 입고·취소가 필요)
  // ============================================================
  const siblings = useSetSiblings(activeItems);
  const {
    arrivalMap,
    packedMap,
    cancelMap,
    returnMap,
    exportMap,
    shippedItemMap,
    rawFulfillments,
    refreshFulfillments,
  } = useFtFulfillmentSummary(siblings.allItems, selectedUserId);
  const rowMaps = useMemo(
    () => ({ arrivalMap, cancelMap, returnMap, packedMap, shippedItemMap, exportMap }),
    [arrivalMap, cancelMap, returnMap, packedMap, shippedItemMap, exportMap]
  );

  // ============================================================
  // 4) Worker / PC-NO · 운송장 (V2 공용 훅)
  // ============================================================
  const workers = useWorkers();
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedPcNo, setSelectedPcNo] = useState<number | null>(null);
  const invoice = usePersonalInvoicePrint({ selectedUserId, selectedWorker, activeItems, t });

  // ============================================================
  // 5) 보드 + 모달
  // ============================================================
  const boards = useCardGroups(displayItems, arrivalMap, cancelMap);
  const [openBoardKey, setOpenBoardKey] = useState<string | null>(null);
  const openBoard = useMemo(() => boards.find((b) => b.key === openBoardKey) ?? null, [boards, openBoardKey]);

  const { loadForRows: loadSiblings, reset: resetSiblings } = siblings;
  const handleOpenBoard = useCallback(
    (boardKey: string) => {
      const board = boards.find((b) => b.key === boardKey);
      if (!board) return;
      setOpenBoardKey(boardKey);
      // 다른 PC 가 방금 저장한 입고를 반영해 잔여를 최신화 + 세트 형제 행 조회
      refreshFulfillments();
      loadSiblings(board.rows);
    },
    [boards, refreshFulfillments, loadSiblings]
  );

  // ============================================================
  // 6) 데이터 초기화 / 재조회 헬퍼
  // ============================================================
  const resetView = useCallback(() => {
    setDeliveryItems(null);
    setLastDeliveryCode('');
    setSearchInput('');
    clearSearch();
    resetSiblings();
    setOpenBoardKey(null);
  }, [clearSearch, resetSiblings]);

  const runDeliverySearch = useCallback(
    async (code: string, { silent = false }: { silent?: boolean } = {}) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setIsDeliverySearching(true);
      try {
        const res = await fetch(`/api/ft/order-items/by-delivery-code?delivery_code=${encodeURIComponent(trimmed)}`);
        const json = await res.json();
        if (json.success) {
          setDeliveryItems(json.data);
          setLastDeliveryCode(trimmed);
          if (!silent && json.data.length === 0) alert(t('importProductV2.alerts.deliveryNoResult'));
        } else {
          alert(json.error || '배송번호 조회 중 오류가 발생했습니다.');
        }
      } catch {
        alert('배송번호 조회 중 오류가 발생했습니다.');
      } finally {
        setIsDeliverySearching(false);
      }
    },
    [t]
  );

  /** 비고·반품 저장 후 — 사용자 목록 + (배송번호 결과가 있으면) 그 결과도 다시 받는다 */
  const reloadData = useCallback(() => {
    if (selectedUserId) fetchItems(selectedUserId, statusFilter);
    if (searchType === '배송번호' && lastDeliveryCode) runDeliverySearch(lastDeliveryCode, { silent: true });
    refreshFulfillments();
  }, [selectedUserId, statusFilter, fetchItems, searchType, lastDeliveryCode, runDeliverySearch, refreshFulfillments]);

  // ============================================================
  // 7) 사용자 / 상태 필터 / 검색 핸들러
  // ============================================================
  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const userId = e.target.value;
      setSelectedUserId(userId);
      resetView();
      if (userId) fetchItems(userId, statusFilter);
    },
    [fetchItems, statusFilter, resetView]
  );

  const handleStatusFilterChange = useCallback(
    (next: StatusFilter) => {
      setStatusFilter(next);
      resetView();
      if (selectedUserId) fetchItems(selectedUserId, next);
    },
    [fetchItems, selectedUserId, resetView]
  );

  const handleSearchTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSearchType(e.target.value);
      resetView();
    },
    [resetView]
  );

  const applySearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      resetSiblings();
      setOpenBoardKey(null);
      if (!trimmed) {
        setDeliveryItems(null);
        setLastDeliveryCode('');
        clearSearch();
        return;
      }
      if (searchType === '배송번호') runDeliverySearch(trimmed);
      else setSearchTerm(trimmed);
    },
    [searchType, runDeliverySearch, setSearchTerm, clearSearch, resetSiblings]
  );

  // ============================================================
  // 8) 저장 / 라벨 즉시 출력 — hooks/useInboundActions.ts
  //    (V2 와 같은 ARRIVAL + BarTender 저장, 사용자 일치·한도 재검증, mergeSets:false 출력)
  // ============================================================
  const actions = useInboundActions({
    selectedUserId,
    selectedUser,
    users,
    selectedWorker,
    selectedPcNo,
    refreshFulfillments,
    t,
  });

  // ============================================================
  // 9) 부가 모달 — 반품 / 비고 / 고객확인 / 처리 로그
  // ============================================================
  const [cancelTarget, setCancelTarget] = useState<FtOrderItem[] | null>(null);
  const [noteTarget, setNoteTarget] = useState<FtOrderItem[] | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<FtOrderItem[] | null>(null);
  const [logItem, setLogItem] = useState<FtOrderItem | null>(null);
  const [logDeliveryCodes, setLogDeliveryCodes] = useState<string[]>([]);
  const [logDeliveryCodesLoading, setLogDeliveryCodesLoading] = useState(false);

  const noteInitial = useMemo(() => {
    const notes = Array.from(new Set((noteTarget ?? []).map((i) => i.note_cn || '')));
    return notes.length === 1 ? notes[0] : '';
  }, [noteTarget]);

  const handleOpenLog = useCallback((item: FtOrderItem) => {
    setLogItem(item);
    setLogDeliveryCodes([]);
    const orderId = item['1688_order_id'];
    if (!orderId) return;
    setLogDeliveryCodesLoading(true);
    fetch(`/api/ft/delivery-codes?order_id=${encodeURIComponent(orderId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setLogDeliveryCodes(json.data);
      })
      .catch(() => {})
      .finally(() => setLogDeliveryCodesLoading(false));
  }, []);

  const handleFulfillmentDelete = useCallback(
    async (fulfillmentId: string) => {
      const res = await fetch(`/api/ft/fulfillments?id=${fulfillmentId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        alert(result.error || '삭제 실패');
        return;
      }
      refreshFulfillments();
    },
    [refreshFulfillments]
  );

  // ============================================================
  // 안내 문구
  // ============================================================
  const loading = usersLoading || itemsLoading || isDeliverySearching;
  const emptyMessage = !selectedUserId
    ? t('importProductV2.alerts.selectUser')
    : hasSearched || showAll
      ? t('importProductV3.noResult')
      : t('importProductV3.searchFirst');

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="v2-item-layout">
      <TopsideMenu />
      <div className="v2-item-main-content">
        <LeftsideMenu />
        <main className="v2-item-content">
          <div className="v2-item-container">
            {/* ============================================================ */}
            {/* 타이틀 행 — 제목 + [V2 이전] / Worker · PC-NO · 사용자        */}
            {/* ============================================================ */}
            <div className="v2-title-row">
              <div className="v2-title-left">
                <h1 className="v2-item-title">{t('importProductV3.title')}</h1>
              </div>
              <div className="v2-title-dropdowns">
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedWorker}
                  onChange={(e) => setSelectedWorker(e.target.value)}
                >
                  <option value="">{t('importProductV2.worker')}</option>
                  {workers.map((w) => (
                    <option key={w.id} value={`${w.name} ${w.name_kr}`}>
                      {w.name} {w.name_kr}
                    </option>
                  ))}
                </select>
                <select
                  className="v2-coupang-user-dropdown"
                  value={selectedPcNo ?? ''}
                  onChange={(e) => setSelectedPcNo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t('importProductV2.pcNo')}</option>
                  {PC_NO_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select className="v2-coupang-user-dropdown" value={selectedUserId} onChange={handleUserChange}>
                  <option value="">{t('importProductV2.selectUser')}</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 검색 — 상태 필터 · [전체 보기] · 검색유형                      */}
            {/* ============================================================ */}
            <SearchSection
              searchType={searchType}
              searchTerm={searchInput}
              onSearchTypeChange={handleSearchTypeChange}
              onSearchInputChange={(e) => setSearchInput(e.target.value)}
              onSearchKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applySearch(searchInput);
                }
              }}
              onSearchClick={() => applySearch(searchInput)}
              isSearching={isDeliverySearching}
              statusFilter={statusFilter}
              onStatusFilterChange={(s) => handleStatusFilterChange(s as StatusFilter)}
              filteredItemsCount={filteredItems.length}
              groupByProduct={showAll}
              onGroupByProductChange={setShowAll}
              groupToggleLabel={t('importProductV3.showAll')}
            />

            {/* ============================================================ */}
            {/* 카드 그리드                                                   */}
            {/* ============================================================ */}
            <BoardGrid boards={boards} loading={loading} emptyMessage={emptyMessage} onOpen={handleOpenBoard} />
          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 카드 모달 — 부가 모달보다 먼저 렌더 (같은 z-index 에서 부가 모달이 위)  */}
      {/* ============================================================ */}
      <CardModal
        board={openBoard}
        partsByProductId={siblings.partsByProductId}
        maps={rowMaps}
        selectedUserId={selectedUserId}
        invoicePdfSet={invoice.invoicePdfSet}
        isItemInvoicePrintable={invoice.isItemInvoicePrintable}
        onPrintInvoices={invoice.printInvoicesForItems}
        onSave={actions.save}
        onPrintLabel={actions.printLabel}
        onOpenCancel={setCancelTarget}
        onOpenNote={setNoteTarget}
        onOpenCustomerConfirm={setConfirmTarget}
        onOpenLog={handleOpenLog}
        onClose={() => setOpenBoardKey(null)}
      />

      {/* ============================================================ */}
      {/* 반품 접수                                                     */}
      {/* ============================================================ */}
      <V2CancelModal
        isOpen={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        items={cancelTarget ?? EMPTY_ITEMS}
        selectedUserId={selectedUserId}
        selectedOperator={selectedWorker}
        arrivalMap={arrivalMap}
        cancelMap={cancelMap}
        returnMap={returnMap}
        onSaveComplete={() => {
          setCancelTarget(null);
          reloadData();
        }}
      />

      {/* ============================================================ */}
      {/* 비고                                                          */}
      {/* ============================================================ */}
      <V2NoteModal
        isOpen={noteTarget !== null}
        onClose={() => setNoteTarget(null)}
        selectedIds={(noteTarget ?? EMPTY_ITEMS).map((i) => i.id)}
        initialNote={noteInitial}
        onSaveComplete={() => {
          setNoteTarget(null);
          reloadData();
        }}
      />

      {/* ============================================================ */}
      {/* 고객확인 (Notion)                                              */}
      {/* ============================================================ */}
      <V2CustomerConfirmModal
        isOpen={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        items={confirmTarget ?? EMPTY_ITEMS}
        sellerCode={selectedUser?.user_code || ''}
        arrivalMap={arrivalMap}
        onSaveComplete={() => setConfirmTarget(null)}
      />

      {/* ============================================================ */}
      {/* 처리 로그 — 상품명 클릭                                       */}
      {/* ============================================================ */}
      <FulfillmentLogModal
        isOpen={logItem !== null}
        item={logItem}
        rawFulfillments={rawFulfillments}
        onClose={() => {
          setLogItem(null);
          setLogDeliveryCodes([]);
        }}
        onDelete={handleFulfillmentDelete}
        deliveryCodes={logDeliveryCodes}
        deliveryCodesLoading={logDeliveryCodesLoading}
      />
    </div>
  );
};

export default ImportV3;
