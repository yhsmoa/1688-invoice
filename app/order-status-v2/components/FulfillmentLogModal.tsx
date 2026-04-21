'use client';

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { FtOrderItem, FulfillmentRow } from '../hooks/useOrderStatusData';

// ============================================================
// FulfillmentLogModal (order-status-v2 전용 복제본)
//
// 상품명(또는 주문번호) 클릭 시 오른쪽 슬라이드 드로워.
// ft_fulfillments 처리 로그를 시간순으로 표시 + 삭제 기능.
// 스타일 클래스는 os-v2-* 로 네임스페이스 분리 (import-product-v2와 독립).
// ============================================================

interface FulfillmentLogModalProps {
  isOpen: boolean;
  item: FtOrderItem | null;
  rawFulfillments: FulfillmentRow[];
  onClose: () => void;
  onDelete: (fulfillmentId: string) => Promise<void>;
  deliveryCodes?: string[];
  deliveryCodesLoading?: boolean;
}

// ── type → 한글 라벨 ──
const TYPE_LABEL: Record<string, string> = {
  ARRIVAL: '입고',
  PACKED: '포장',
  CANCEL: '취소',
  SHIPMENT: '출고',
};

// ── type → 배지 컬러 클래스 ──
const TYPE_BADGE_CLASS: Record<string, string> = {
  ARRIVAL: 'os-v2-badge-arrival',
  PACKED: 'os-v2-badge-packed',
  CANCEL: 'os-v2-badge-cancel',
  SHIPMENT: 'os-v2-badge-shipment',
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

  // ── SSR 대응: 클라이언트 마운트 후에만 portal 사용 ──
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // ── 해당 아이템의 로그 (시간순 오름차순) ──
  const logs = useMemo(() => {
    if (!item) return [];
    return rawFulfillments
      .filter((f) => f.order_item_id === item.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [item, rawFulfillments]);

  // ── 삭제 핸들러 (CANCEL: 철회 안내) ──
  const handleDelete = useCallback(
    async (fulfillmentId: string, logType: string) => {
      const isCancel = logType === 'CANCEL';
      const confirmMsg = isCancel
        ? '반품 접수 기록을 철회하시겠습니까?\n(ft_fulfillments + ft_cancel_details 동시 삭제, DONE 상태였다면 PROCESSING으로 복구됩니다)'
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

  if (!isOpen || !item || !mounted) return null;

  // ============================================================
  // 렌더링 — createPortal 로 document.body 에 직접 마운트
  // (부모 레이아웃/stacking-context 영향 차단)
  // ============================================================
  return createPortal(
    <div className="os-v2-drawer-overlay" onClick={onClose}>
      <div className="os-v2-log-drawer" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="os-v2-drawer-header">
          <h2 style={{ fontSize: 16 }}>처리 로그</h2>
          <button className="os-v2-close-btn" onClick={onClose}>×</button>
        </div>

        {/* 상품 요약 */}
        <div className="os-v2-log-item-summary">
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

        {/* ── 상품 이미지 (300x300, 가로 중앙) — image-proxy 경유로 CDN 처리 ── */}
        {item.img_url && (
          <div className="os-v2-log-image-wrap">
            <img
              className="os-v2-log-image"
              src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
              alt={item.item_name || '상품 이미지'}
              width={300}
              height={300}
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
          </div>
        )}

        {/* 로그 테이블 */}
        <div className="os-v2-drawer-content">
          {logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999', fontSize: 14 }}>
              처리 로그가 없습니다.
            </div>
          ) : (
            <table className="os-v2-log-table">
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
                    <td>
                      <span className={`os-v2-log-badge ${TYPE_BADGE_CLASS[log.type] || ''}`}>
                        {TYPE_LABEL[log.type] || log.type}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{log.quantity}</td>
                    <td>{log.operator_name || '-'}</td>
                    <td style={{ color: '#555', whiteSpace: 'nowrap' }}>
                      {new Date(log.created_at).toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="os-v2-log-delete-btn"
                        onClick={() => handleDelete(log.id, log.type)}
                        disabled={deletingId === log.id}
                        title={log.type === 'CANCEL' ? '반품 철회' : '삭제'}
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
    </div>,
    document.body
  );
};

export default FulfillmentLogModal;
