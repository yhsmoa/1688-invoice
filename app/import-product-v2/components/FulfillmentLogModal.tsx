'use client';

import React, { useMemo, useCallback, useState } from 'react';
import type { FtOrderItem, FulfillmentRow } from '../hooks/useFtData';

// ============================================================
// FulfillmentLogModal — 상품명 클릭 시 오른쪽 슬라이드 모달
// ft_fulfillments 처리 로그를 시간순으로 표시 + 삭제 기능
// ============================================================

interface FulfillmentLogModalProps {
  isOpen: boolean;
  item: FtOrderItem | null;
  rawFulfillments: FulfillmentRow[];
  onClose: () => void;
  onDelete: (fulfillmentId: string) => Promise<void>;
  /** 해당 아이템의 delivery_code 목록 */
  deliveryCodes?: string[];
  deliveryCodesLoading?: boolean;
}

/** type → 한글 라벨 */
const TYPE_LABEL: Record<string, string> = {
  ARRIVAL: '입고',
  PACKED: '포장',
  CANCEL: '주문 취소',
  RETURN: '반품 접수',
  SHIPMENT: '출고',
};

/** type → 배지 CSS 클래스 (CANCEL/RETURN 동일 스타일 — 사용자 결정: 단일 컬럼 통합) */
const TYPE_BADGE_CLASS: Record<string, string> = {
  ARRIVAL: 'v2-import-qty',
  PACKED: 'v2-packed-qty',
  CANCEL: 'v2-cancel-qty',
  RETURN: 'v2-cancel-qty',
  SHIPMENT: 'v2-export-qty',
};

/** type → 철회/삭제 액션 라벨 (cancel-like 두 type 은 '철회', 기타는 '삭제') */
const TYPE_DELETE_LABEL: Record<string, string> = {
  CANCEL: '주문 취소 철회',
  RETURN: '반품 철회',
};

const FulfillmentLogModal: React.FC<FulfillmentLogModalProps> = ({
  isOpen,
  item,
  rawFulfillments,
  onClose,
  onDelete,
  deliveryCodes = [],
  deliveryCodesLoading = false,
}) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 해당 아이템의 fulfillment 로그 (시간순 정렬) ──
  const logs = useMemo(() => {
    if (!item) return [];
    return rawFulfillments
      .filter((f) => f.order_item_id === item.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [item, rawFulfillments]);

  // ── 삭제 핸들러 ──
  // CANCEL/RETURN 타입: ft_cancel_details 연동 삭제 + ft_order_items status 복구 포함
  const handleDelete = useCallback(
    async (fulfillmentId: string, logType: string) => {
      const isCancelLike = logType === 'CANCEL' || logType === 'RETURN';
      const actionName = logType === 'CANCEL' ? '주문 취소' : logType === 'RETURN' ? '반품 접수' : '기록';
      const confirmMsg = isCancelLike
        ? `${actionName} 기록을 철회하시겠습니까?\n(ft_fulfillment_inbounds + ft_cancel_details 동시 삭제, DONE 상태였다면 PROCESSING 으로 복구됩니다)`
        : '이 기록을 삭제하시겠습니까?';

      if (!confirm(confirmMsg)) return;
      setDeletingId(fulfillmentId);
      try {
        await onDelete(fulfillmentId);
      } finally {
        setDeletingId(null);
      }
    },
    [onDelete]
  );

  if (!isOpen || !item) return null;

  return (
    <div className="v2-drawer-overlay" onClick={onClose}>
      <div className="v2-log-drawer" onClick={(e) => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <div className="v2-drawer-header">
          <h2 style={{ fontSize: 16 }}>처리 로그</h2>
          <button className="v2-close-btn" onClick={onClose}>×</button>
        </div>

        {/* ── 상품 정보 요약 ── */}
        <div className="v2-log-item-summary">
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {[item.item_name, item.option_name].filter(Boolean).join(', ')}
          </div>
          <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>
            {item.item_no || '-'} | {item.order_qty ?? 0}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            1688 order no: {item['1688_order_id'] || '-'}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            delivery code: {deliveryCodesLoading ? '조회 중...' : (deliveryCodes.length > 0 ? deliveryCodes.join(', ') : '-')}
          </div>
        </div>

        {/* ── 로그 테이블 ── */}
        <div className="v2-drawer-content">
          {logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 14 }}>
              처리 로그가 없습니다.
            </div>
          ) : (
            <table className="v2-log-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>유형</th>
                  <th style={{ width: 45, textAlign: 'center' }}>수량</th>
                  <th style={{ width: 50 }}>작업자</th>
                  <th>시간</th>
                  <th style={{ width: 36, textAlign: 'center' }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    {/* 유형 배지 */}
                    <td>
                      <span className={`v2-qty-badge ${TYPE_BADGE_CLASS[log.type] || ''}`}>
                        {TYPE_LABEL[log.type] || log.type}
                      </span>
                    </td>
                    {/* 수량 — 가운데 정렬 */}
                    <td style={{ textAlign: 'center' }}>
                      {log.quantity}
                    </td>
                    {/* 작업자 */}
                    <td>
                      {log.operator_name || '-'}
                    </td>
                    {/* 시간 */}
                    <td style={{ color: '#555', whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    {/* 🗑️ 삭제 버튼 (CANCEL/RETURN: 철회, 기타: 단순 삭제) */}
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="v2-log-delete-btn"
                        onClick={() => handleDelete(log.id, log.type)}
                        disabled={deletingId === log.id}
                        title={TYPE_DELETE_LABEL[log.type] || '삭제'}
                      >
                        {deletingId === log.id ? '...' : '🗑️'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default FulfillmentLogModal;
