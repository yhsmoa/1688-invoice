'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import {
  useFtUsers,
  useFtOrderItems,
  useFtFulfillmentSummary,
  use1688DeliveryStatus,
  type FtOrderItem,
} from './hooks/useOrderStatusData';
import FulfillmentLogModal from './components/FulfillmentLogModal';
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
const OrderStatusV2: React.FC = () => {
  // ============================================================
  // 1) 사용자 드롭박스 (ft_users)
  // ============================================================
  const { users: ftUsers } = useFtUsers();
  const [selectedUserId, setSelectedUserId] = useState('');

  // ============================================================
  // 2) 데이터 조회 (order-status-v2 전용 훅)
  // ============================================================
  const { items, loading, fetchItems, clearItems } = useFtOrderItems();
  const {
    arrivalMap,
    packedMap,
    cancelMap,
    exportMap,
    rawFulfillments,
    refreshFulfillments,
  } = useFtFulfillmentSummary(items);

  // 배송 상태 (im_1688_orders_delivery_status)
  const { statusMap: deliveryStatusMap } = use1688DeliveryStatus(items);

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
  // 3) 검색 입력 (UI 골격 — 후속 연결)
  // ============================================================
  const [searchInput, setSearchInput] = useState('');

  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value),
    []
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // 검색 실행 — 후속 스펙
      }
    },
    []
  );

  // ============================================================
  // 4) 체크박스 선택
  // ============================================================
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // 사용자 변경 시 선택 초기화
  useEffect(() => {
    setSelectedRows(new Set());
  }, [selectedUserId]);

  const isAllSelected = useMemo(
    () => items.length > 0 && items.every((item) => selectedRows.has(item.id)),
    [items, selectedRows]
  );

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedRows(() => (checked ? new Set(items.map((i) => i.id)) : new Set()));
    },
    [items]
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
  // 5) 처리 로그 모달
  // ============================================================
  const [logModalItem, setLogModalItem] = useState<FtOrderItem | null>(null);
  const [logDeliveryCodes, setLogDeliveryCodes] = useState<string[]>([]);
  const [logDeliveryCodesLoading, setLogDeliveryCodesLoading] = useState(false);

  const handleOrderRowClick = useCallback((item: FtOrderItem) => {
    setLogModalItem(item);
    // delivery_codes 조회
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
  // 6) 액션 버튼 UI 상태
  // ============================================================
  const checkedCount = selectedRows.size;
  const dirtyCount = 0;

  // ── 테이블 총 colSpan (12열: 작업 컬럼 제거) ──
  const TOTAL_COLS = 12;

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
                  <span className="order-status-v2-count">총 {items.length}건</span>
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
              <button className="order-status-v2-search-btn">검색</button>
            </div>

            {/* ── 액션 바 ── */}
            <div className="order-status-v2-action-bar">
              <div className="order-status-v2-action-left">
                <button className="order-status-v2-move-btn" disabled={items.length === 0}>품목</button>
                <button className="order-status-v2-excel-btn" disabled={items.length === 0}>엑셀</button>
                <button className="order-status-v2-move-btn" disabled={checkedCount === 0}>이동</button>
                <button className="order-status-v2-merge-btn" disabled={!selectedUserId}>합배송</button>
                <button className="order-status-v2-ship-btn" disabled={checkedCount === 0}>출고</button>
              </div>
              <div className="order-status-v2-action-right">
                <button
                  className={`order-status-v2-save-btn ${dirtyCount > 0 ? 'order-status-v2-save-btn--dirty' : ''}`}
                  disabled={dirtyCount === 0}
                >
                  저장{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
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
                    <th>옵션명</th>
                    <th className="os-v2-col-num">개수</th>
                    <th className="os-v2-col-num">진행</th>
                    <th className="os-v2-col-num">입고</th>
                    <th className="os-v2-col-num">포장</th>
                    <th className="os-v2-col-num">취소</th>
                    <th className="os-v2-col-num">출고</th>
                    <th className="os-v2-col-type">타입</th>
                    <th>배송</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">로딩 중...</td></tr>
                  ) : !selectedUserId ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">사용자를 선택해주세요.</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={TOTAL_COLS} className="order-status-v2-empty">데이터 없음</td></tr>
                  ) : (
                    items.map((item) => {
                      // ── 수량 계산 (import-product-v2 ItemTableRow 로직 1:1) ──
                      const arrivalQty = arrivalMap.get(item.id) ?? 0;
                      const packedQty = packedMap.get(item.id) ?? 0;
                      const cancelQty = cancelMap.get(item.id) ?? 0;
                      const shipmentQty = exportMap.get(item.product_id ?? '') ?? 0;
                      const progressQty = (item.order_qty ?? 0) - arrivalQty - cancelQty;

                      // ── 타입 배지 ──
                      const typeBadge = resolveSizeBadge(
                        item.shipment_type,
                        item.coupang_shipment_size
                      );

                      const isChecked = selectedRows.has(item.id);

                      return (
                        <tr
                          key={item.id}
                          className={isChecked ? 'order-status-v2-row--checked' : ''}
                        >
                          <td className="os-v2-col-check">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                            />
                          </td>
                          {/* 주문번호 (item_no) — 클릭 → 처리 로그 모달 */}
                          <td
                            className="os-v2-clickable os-v2-col-orderno"
                            onClick={() => handleOrderRowClick(item)}
                          >
                            {item.item_no || '-'}
                          </td>
                          {/* 상품정보 — 클릭 시 site_url 새 탭 */}
                          <td
                            className={item.site_url ? 'os-v2-clickable' : undefined}
                            onClick={item.site_url ? () => handleProductInfoClick(item) : undefined}
                          >
                            {item.item_name || '-'}
                          </td>
                          <td>{item.option_name || '-'}</td>
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
                            {cancelQty > 0 ? cancelQty : ''}
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
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>
        </main>
      </div>

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
    </div>
  );
};

export default OrderStatusV2;
