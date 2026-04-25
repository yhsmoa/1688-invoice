'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import {
  useFtUsers,
  useFtOrderItems,
  useFtFulfillmentSummary,
  use1688DeliveryStatus,
  useOrderStatusPagination,
  type FtOrderItem,
} from './hooks/useOrderStatusData';
import FulfillmentLogModal from './components/FulfillmentLogModal';
import V2CancelModal from '../import-product-v2/components/V2CancelModal';
import { formatDeliveryDisplay } from './utils/deliveryStatusMap';
import { resolveSizeBadge } from '../../lib/sizeCode';
import './OrderStatusV2.css';

// ============================================================
// 주문상태 V2
//
// 데이터 로직은 /import-product-v2 와 기능적으로 동일하되,
// 훅/컴포넌트/스타일은 전부 독립 (os-v2-* 네임스페이스).
// 두 페이지의 기능 분화 시 서로 영향 없도록 설계.
// ============================================================

// ── 세트 그룹 키: 같은 세트(set_total > 1 + 같은 order_no + product_id) 이면 동일 key,
//    그 외는 null. 연속 행이 같은 key면 행 사이 border 제거 대상.
function getSetGroupKey(item: FtOrderItem): string | null {
  if (item.set_total == null || item.set_total <= 1) return null;
  if (!item.product_id) return null;
  return `${item.order_no ?? ''}|${item.product_id}`;
}

const OrderStatusV2: React.FC = () => {
  // ============================================================
  // 1) 사용자 드롭박스 (ft_users)
  // ============================================================
  const { users: ftUsers } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');

  // ============================================================
  // 2) 데이터 조회 (order-status-v2 전용 훅)
  // ============================================================
  const { items, loading, fetchItems, clearItems, patchItem } = useFtOrderItems();
  const {
    arrivalMap,
    packedMap,
    cancelMap,
    returnMap,
    exportMap,
    shippedItemMap,
    rawFulfillments,
    refreshFulfillments,
  } = useFtFulfillmentSummary(items);

  // 배송 상태 (im_1688_orders_delivery_status)
  const { statusMap: deliveryStatusMap } = use1688DeliveryStatus(items);

  // 검색 state — filteredItems 계산 전에 선언 (TDZ 회피)
  const [searchInput, setSearchInput] = useState('');
  // null = 필터 비활성(전체), Set = 해당 id 만 표시
  const [searchFilteredIds, setSearchFilteredIds] = useState<Set<string> | null>(null);
  const [searching, setSearching] = useState(false);

  // ── 검색 필터 적용 (필터 없으면 items 전체) ──
  const filteredItems = useMemo(() => {
    if (searchFilteredIds === null) return items;
    return items.filter((i) => searchFilteredIds.has(i.id));
  }, [items, searchFilteredIds]);

  // ── 페이지네이션 (100개/page) — filteredItems 기준 ──
  const {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    goToNextPage,
    goToPrevPage,
  } = useOrderStatusPagination(filteredItems, 100);

  // ── 세트 그룹 키 배열 (paginatedData 순서 기준) ──
  //    렌더 시 thisKey === nextKey 인 행에 '--same-group' 클래스 부여 → 행 사이 border 제거
  const setGroupRowKeys = useMemo(
    () => paginatedData.map(getSetGroupKey),
    [paginatedData]
  );

  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const userId = e.target.value;
      setSelectedUserId(userId);
      if (userId) fetchItems(userId, 'PROCESSING');
      else clearItems();
    },
    [fetchItems, clearItems]
  );

  // ============================================================
  // 3) 검색 — 5개 필드 OR 매칭
  //    · 주문번호(item_no) / 상품정보(item_name+option_name) / CN옵션명(china_option1+2)
  //      / 1688_order_id  → 로컬 contains(대소문자 무관)
  //    · delivery_code   → 서버 조회 (/api/ft/order-items/by-delivery-code)
  //    · 동적 필터 X — Enter 또는 [검색] 클릭 시에만 실행
  //    · 빈 값으로 실행 → 필터 해제 (전체 표시)
  //    · state 선언은 상단(filteredItems 계산 전)에 위치
  // ============================================================
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value),
    []
  );

  const executeSearch = useCallback(async () => {
    const rawTerm = searchInput.trim();
    // 빈 값 → 필터 해제
    if (!rawTerm) {
      setSearchFilteredIds(null);
      setEditingCell(null);
      return;
    }

    const lowered = rawTerm.toLowerCase();
    setSearching(true);
    setEditingCell(null);

    // ── 1) 로컬 4개 필드 매칭 (contains, 대소문자 무관) ──
    const matched = new Set<string>();
    for (const it of items) {
      const hay = [
        it.item_no,
        it.item_name,
        it.option_name,
        it.china_option1,
        it.china_option2,
        it['1688_order_id'],
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      if (hay.includes(lowered)) matched.add(it.id);
    }

    // ── 2) delivery_code 서버 조회 + 현재 items와 교집합 ──
    try {
      const res = await fetch(
        `/api/ft/order-items/by-delivery-code?delivery_code=${encodeURIComponent(rawTerm)}`,
      );
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const serverIds = new Set<string>(json.data.map((r: { id: string }) => r.id));
        for (const it of items) {
          if (serverIds.has(it.id)) matched.add(it.id);
        }
      }
    } catch (err) {
      console.error('delivery_code 검색 오류:', err);
    } finally {
      setSearching(false);
    }

    setSearchFilteredIds(matched);
  }, [searchInput, items]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch();
      }
    },
    [executeSearch],
  );

  // 사용자 변경 시 검색 필터 해제
  useEffect(() => {
    setSearchFilteredIds(null);
    setSearchInput('');
  }, [selectedUserId]);

  // ============================================================
  // 4) 체크박스 선택
  // ============================================================
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // 사용자 변경 시 선택 초기화
  useEffect(() => {
    setSelectedRows(new Set());
  }, [selectedUserId]);

  // 현재 페이지 기준 전체 선택 여부 / 전체 선택 토글 (페이지 전환 시 이전 선택은 유지)
  const isAllSelected = useMemo(
    () => paginatedData.length > 0 && paginatedData.every((item) => selectedRows.has(item.id)),
    [paginatedData, selectedRows]
  );

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
  // 5) 처리 로그 모달 + 주문번호 컨텍스트 팝업
  //    주문번호 셀 클릭 → 컨텍스트 팝업 (1688_order_no 복사 / 처리 로그 열기)
  // ============================================================
  const [logModalItem, setLogModalItem] = useState<FtOrderItem | null>(null);
  const [logDeliveryCodes, setLogDeliveryCodes] = useState<string[]>([]);
  const [logDeliveryCodesLoading, setLogDeliveryCodesLoading] = useState(false);

  // 주문번호 셀 옆 팝업: { item, x, y } | null
  const [orderPopup, setOrderPopup] = useState<{
    item: FtOrderItem;
    x: number;
    y: number;
  } | null>(null);

  // 처리 로그 드로워 열기 (기존 동작)
  const openLogDrawer = useCallback((item: FtOrderItem) => {
    setLogModalItem(item);
    setLogDeliveryCodes([]);
    const orderId = item['1688_order_id'];
    if (orderId) {
      setLogDeliveryCodesLoading(true);
      fetch(`/api/ft/delivery-codes?order_id=${encodeURIComponent(orderId)}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setLogDeliveryCodes(json.data);
        })
        .catch(() => {})
        .finally(() => setLogDeliveryCodesLoading(false));
    }
  }, []);

  // 주문번호 셀 클릭 → 마우스 위치에 팝업 오픈
  const handleOrderCellClick = useCallback((e: React.MouseEvent, item: FtOrderItem) => {
    setOrderPopup({ item, x: e.clientX, y: e.clientY });
  }, []);

  // 팝업 → [1688_order_no 복사]
  //   · HTTPS / localhost: navigator.clipboard 사용
  //   · HTTP LAN 등 비보안 컨텍스트: textarea + execCommand('copy') fallback
  const handlePopupCopyOrderNo = useCallback(async () => {
    if (!orderPopup) return;
    const orderId = orderPopup.item['1688_order_id'];
    setOrderPopup(null);
    if (!orderId) return;

    let copied = false;

    // ── 1) 모던 API (보안 컨텍스트) ──
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(orderId);
        copied = true;
      } catch (err) {
        console.error('clipboard.writeText 실패:', err);
      }
    }

    // ── 2) 레거시 fallback (HTTP + LAN IP 지원) ──
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = orderId;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '1px';
        ta.style.height = '1px';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (err) {
        console.error('execCommand copy 실패:', err);
      }
    }

    if (!copied) {
      alert('클립보드 복사에 실패했습니다. 브라우저 설정을 확인해주세요.');
    }
  }, [orderPopup]);

  // 팝업 → [처리 로그]
  const handlePopupOpenLog = useCallback(() => {
    if (!orderPopup) return;
    const item = orderPopup.item;
    setOrderPopup(null);
    openLogDrawer(item);
  }, [orderPopup, openLogDrawer]);

  const handleLogModalClose = useCallback(() => {
    setLogModalItem(null);
    setLogDeliveryCodes([]);
  }, []);

  // 상품정보 클릭 → site_url 새 탭 오픈
  const handleProductInfoClick = useCallback((item: FtOrderItem) => {
    const url = item.site_url?.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    window.open(normalized, '_blank', 'noopener,noreferrer');
  }, []);

  // ============================================================
  // 7) 비고 KR/CN 인라인 편집 (contentEditable + blur 저장)
  // ============================================================
  type NoteField = 'note_notice' | 'note_cn';

  const [editingCell, setEditingCell] = useState<{ id: string; field: NoteField } | null>(null);
  const editingCellRef = useRef<HTMLTableCellElement | null>(null);

  // 편집 시작 시 해당 셀에 focus + 커서 맨 뒤로
  useEffect(() => {
    if (!editingCell) return;
    const el = editingCellRef.current;
    if (!el) return;
    el.focus();
    // 커서를 컨텐츠 끝으로 이동
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingCell]);

  const handleStartEditNote = useCallback((id: string, field: NoteField) => {
    setEditingCell({ id, field });
  }, []);

  const handleFinishEditNote = useCallback(async (
    id: string,
    field: NoteField,
    rawValue: string,
  ) => {
    // contentEditable innerText 를 그대로 사용 (줄바꿈 \n 보존)
    const next = rawValue ?? '';
    const current = items.find((i) => i.id === id)?.[field] ?? '';
    setEditingCell(null);

    // 동일값 → 네트워크 호출 skip
    if (next === (current ?? '')) return;

    // ── optimistic 로컬 업데이트 ──
    const nextValue = next === '' ? null : next;
    patchItem(id, { [field]: nextValue });

    // ── PATCH ──
    try {
      const res = await fetch('/api/ft/order-items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, fields: { [field]: nextValue } }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        // 실패 → 롤백
        patchItem(id, { [field]: current });
        alert('비고 저장 실패: ' + (json.error || '알 수 없는 오류'));
      }
    } catch (err) {
      patchItem(id, { [field]: current });
      alert('비고 저장 중 오류: ' + (err instanceof Error ? err.message : ''));
    }
  }, [items, patchItem]);

  const handleFulfillmentDelete = useCallback(async (fulfillmentId: string) => {
    const res = await fetch(`/api/ft/fulfillments?id=${fulfillmentId}`, { method: 'DELETE' });
    const result = await res.json();
    if (!result.success) {
      alert(result.error || '삭제 실패');
      return;
    }
    refreshFulfillments();
  }, [refreshFulfillments]);

  // ============================================================
  // 8) 액션 버튼 UI 상태
  // ============================================================
  const checkedCount = selectedRows.size;

  // ============================================================
  // 8-1) 반품 모달 — /import-product-v2 의 V2CancelModal 재사용
  //   체크된 행 있으면 해당 항목, 없으면 전체 items — 기존 import-product-v2 패턴 동일
  // ============================================================
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);

  const cancelItems = useMemo(
    () => (selectedRows.size > 0
      ? items.filter((item) => selectedRows.has(item.id))
      : items),
    [items, selectedRows]
  );

  // ── 테이블 총 colSpan (14열: 기존 12 + 비고 KR + 비고 CN) ──
  const TOTAL_COLS = 14;

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="order-status-v2-layout">
      <TopsideMenu />
      <div className="order-status-v2-main-content">
        <LeftsideMenu />
        <main className="order-status-v2-content">
          <div className="order-status-v2-container">

            {/* ── 타이틀 + 사용자 드롭다운 ── */}
            <div className="order-status-v2-header">
              <h1 className="order-status-v2-title">주문상태 V2 😈</h1>
              <div className="order-status-v2-header-right">
                {items.length > 0 && (
                  <span className="order-status-v2-count">
                    {searchFilteredIds !== null
                      ? `${filteredItems.length} / ${items.length}건`
                      : `총 ${items.length}건`}
                  </span>
                )}
                <select
                  className="order-status-v2-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                >
                  <option value="">사용자 선택</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 검색 폼 ── */}
            <div className="order-status-v2-search-bar">
              <input
                type="text"
                className="order-status-v2-search-input"
                placeholder="검색어를 입력하세요"
                value={searchInput}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
              />
              <button
                className="order-status-v2-search-btn"
                onClick={executeSearch}
                disabled={searching}
              >
                {searching ? '검색 중...' : '검색'}
              </button>
            </div>

            {/* ── 액션 바: 반품 버튼 (오른쪽) ── */}
            <div className="order-status-v2-action-bar">
              <div className="order-status-v2-action-left" />
              <div className="order-status-v2-action-right">
                <button
                  className="order-status-v2-move-btn"
                  disabled={!selectedUserId || items.length === 0}
                  onClick={() => setIsCancelModalOpen(true)}
                >
                  반품
                </button>
              </div>
            </div>

            {/* ============================================================ */}
            {/* 테이블 (12열: 체크/주문번호/상품정보/옵션명/개수/진행/입고/포장/취소/출고/타입/배송) */}
            {/* ============================================================ */}
            <div className="order-status-v2-table-board">
              <table className="order-status-v2-table">
                <thead>
                  <tr>
                    <th className="os-v2-col-check">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th>주문번호</th>
                    <th>상품정보</th>
                    <th>cn 옵션명</th>
                    <th className="os-v2-col-num">개수</th>
                    <th className="os-v2-col-num">진행</th>
                    <th className="os-v2-col-num">입고</th>
                    <th className="os-v2-col-num">포장</th>
                    <th className="os-v2-col-num">취소</th>
                    <th className="os-v2-col-num">출고</th>
                    <th className="os-v2-col-type">타입</th>
                    <th className="os-v2-col-delivery">배송</th>
                    <th className="os-v2-col-note">공유 비고</th>
                    <th className="os-v2-col-note">비고 CN</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">로딩 중...</td></tr>
                  ) : !selectedUserId ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">사용자를 선택해주세요.</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">데이터 없음</td></tr>
                  ) : filteredItems.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">검색 결과가 없습니다.</td></tr>
                  ) : (
                    paginatedData.map((item, idx) => {
                      // ── 수량 계산 (import-product-v2 ItemTableRow 로직 1:1) ──
                      const arrivalQty = arrivalMap.get(item.id) ?? 0;
                      const packedQty = packedMap.get(item.id) ?? 0;
                      const cancelQty = cancelMap.get(item.id) ?? 0;
                      const returnQty = returnMap.get(item.id) ?? 0;
                      const shippedItemQty = shippedItemMap.get(item.id) ?? 0;
                      const shipmentQty = exportMap.get(item.product_id ?? '') ?? 0;
                      // 진행 = order_qty - CANCEL - RETURN - 출고완료PACKED (raw)
                      const progressQty =
                        (item.order_qty ?? 0) - cancelQty - returnQty - shippedItemQty;
                      // 취소 컬럼 표시 — CANCEL + RETURN 합산 (단일 컬럼)
                      const cancelDisplayQty = cancelQty + returnQty;

                      // ── 타입 배지 ──
                      const typeBadge = resolveSizeBadge(
                        item.shipment_type,
                        item.coupang_shipment_size
                      );

                      const isChecked = selectedRows.has(item.id);

                      // ── 세트 그룹: 다음 행과 같은 그룹이면 현재 행의 행 사이 border 제거 ──
                      const thisKey = setGroupRowKeys[idx];
                      const nextKey = idx < paginatedData.length - 1 ? setGroupRowKeys[idx + 1] : null;
                      const sameGroupAsNext = thisKey !== null && thisKey === nextKey;

                      const rowClassName = [
                        isChecked ? 'order-status-v2-row--checked' : '',
                        sameGroupAsNext ? 'order-status-v2-row--same-group' : '',
                      ].filter(Boolean).join(' ');

                      return (
                        <tr
                          key={item.id}
                          className={rowClassName}
                        >
                          <td className="os-v2-col-check">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                            />
                          </td>
                          {/* 주문번호 (item_no) — 클릭 → 컨텍스트 팝업 (복사 / 처리 로그)
                              드래그로 텍스트 선택한 경우(복사 의도)는 팝업 skip */}
                          <td
                            className="os-v2-clickable os-v2-col-orderno"
                            onClick={(e) => {
                              if ((window.getSelection()?.toString().length ?? 0) > 0) return;
                              handleOrderCellClick(e, item);
                            }}
                          >
                            {item.item_no || '-'}
                          </td>
                          {/* 상품정보 (item_name + option_name) — 클릭 시 site_url 새 탭
                              드래그 복사 시 클릭 액션 skip */}
                          <td
                            className={item.site_url ? 'os-v2-clickable' : undefined}
                            onClick={item.site_url ? () => {
                              if ((window.getSelection()?.toString().length ?? 0) > 0) return;
                              handleProductInfoClick(item);
                            } : undefined}
                          >
                            {[item.item_name, item.option_name].filter(Boolean).join(', ') || '-'}
                          </td>
                          {/* cn 옵션명 (china_option1 + china_option2) */}
                          <td>
                            {[item.china_option1, item.china_option2].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="os-v2-col-num">{item.order_qty ?? ''}</td>
                          <td className="os-v2-col-num os-v2-cell-progress">
                            {progressQty > 0 ? progressQty : ''}
                          </td>
                          <td className="os-v2-col-num os-v2-cell-arrival">
                            {arrivalQty > 0 ? arrivalQty : ''}
                          </td>
                          <td className="os-v2-col-num os-v2-cell-packed">
                            {packedQty > 0 ? packedQty : ''}
                          </td>
                          <td className="os-v2-col-num os-v2-cell-cancel">
                            {cancelDisplayQty > 0 ? cancelDisplayQty : ''}
                          </td>
                          <td className="os-v2-col-num os-v2-cell-shipment">
                            {shipmentQty > 0 ? shipmentQty : ''}
                          </td>
                          <td className="os-v2-col-type">
                            {typeBadge ? (
                              <span className={`size-badge ${typeBadge.colorClass}`}>
                                {typeBadge.code}
                              </span>
                            ) : ''}
                          </td>
                          {/* 배송 (im_1688_orders_delivery_status 조인) */}
                          <td className="os-v2-col-delivery">
                            {(() => {
                              const oid = item['1688_order_id'];
                              if (!oid) return '';
                              const info = deliveryStatusMap.get(oid);
                              return info ? formatDeliveryDisplay(info) : '';
                            })()}
                          </td>
                          {/* ── 비고 KR (note_notice) — 인라인 편집 ── */}
                          {(() => {
                            const isEditing = editingCell?.id === item.id && editingCell?.field === 'note_notice';
                            return (
                              <td
                                className="os-v2-col-note"
                                ref={isEditing ? editingCellRef : undefined}
                                contentEditable={isEditing}
                                suppressContentEditableWarning
                                onClick={() => !isEditing && handleStartEditNote(item.id, 'note_notice')}
                                onBlur={isEditing
                                  ? (e) => handleFinishEditNote(item.id, 'note_notice', e.currentTarget.innerText)
                                  : undefined}
                              >
                                {item.note_notice || ''}
                              </td>
                            );
                          })()}
                          {/* ── 비고 CN (note_cn) — 인라인 편집 ── */}
                          {(() => {
                            const isEditing = editingCell?.id === item.id && editingCell?.field === 'note_cn';
                            return (
                              <td
                                className="os-v2-col-note"
                                ref={isEditing ? editingCellRef : undefined}
                                contentEditable={isEditing}
                                suppressContentEditableWarning
                                onClick={() => !isEditing && handleStartEditNote(item.id, 'note_cn')}
                                onBlur={isEditing
                                  ? (e) => handleFinishEditNote(item.id, 'note_cn', e.currentTarget.innerText)
                                  : undefined}
                              >
                                {item.note_cn || ''}
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* ============================================================ */}
            {/* 페이지네이션 (100개/page) */}
            {/* ============================================================ */}
            {!loading && filteredItems.length > 0 && (
              <div className="order-status-v2-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="order-status-v2-pagination-button"
                >
                  이전
                </button>

                <div className="order-status-v2-page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
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
                        className={`order-status-v2-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="order-status-v2-pagination-button"
                >
                  다음
                </button>

                <span className="order-status-v2-page-info">
                  {currentPage} / {totalPages} 페이지 (총 {filteredItems.length}개)
                </span>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* ============================================================ */}
      {/* 반품 모달 (V2CancelModal 재사용) — /import-product-v2 와 동일 */}
      {/* ============================================================ */}
      <V2CancelModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        items={cancelItems}
        selectedUserId={selectedUserId}
        selectedOperator=""  /* order-status-v2 에는 담당자 드롭박스가 없음 → null 저장 */
        onSaveComplete={() => {
          setIsCancelModalOpen(false);
          setSelectedRows(new Set());
          refreshFulfillments();
          if (selectedUserId) fetchItems(selectedUserId);
        }}
      />

      {/* ============================================================ */}
      {/* 처리 로그 모달 (주문번호/상품정보 클릭 시 오픈)                */}
      {/* ============================================================ */}
      <FulfillmentLogModal
        isOpen={logModalItem !== null}
        item={logModalItem}
        rawFulfillments={rawFulfillments}
        onClose={handleLogModalClose}
        onDelete={handleFulfillmentDelete}
        deliveryCodes={logDeliveryCodes}
        deliveryCodesLoading={logDeliveryCodesLoading}
      />

      {/* ============================================================ */}
      {/* 주문번호 컨텍스트 팝업 — 1688_order_no 복사 / 처리 로그 열기      */}
      {/* ============================================================ */}
      {orderPopup && (
        <>
          {/* 뒷배경(투명) 클릭 시 팝업 닫힘 */}
          <div
            className="os-v2-popup-overlay"
            onClick={() => setOrderPopup(null)}
          />
          <div
            className="os-v2-popup-menu"
            style={{ left: orderPopup.x + 4, top: orderPopup.y + 4 }}
          >
            <button
              className="os-v2-popup-item os-v2-popup-item--primary"
              onClick={handlePopupCopyOrderNo}
              disabled={!orderPopup.item['1688_order_id']}
              title={orderPopup.item['1688_order_id'] ? '클릭하여 복사' : '1688_order_no 없음'}
            >
              {orderPopup.item['1688_order_id'] || '(1688_order_no 없음)'}
            </button>
            <button
              className="os-v2-popup-item"
              onClick={handlePopupOpenLog}
            >
              처리 로그
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default OrderStatusV2;
