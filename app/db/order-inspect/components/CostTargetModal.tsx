'use client';

import React from 'react';
import type { CostTarget, InspectOrder } from '../types';

// ============================================================
// CostTargetModal — [비용처리] 1단계: 어느 계좌에서 차감할지 고른다
//
//   무역계좌      → 회사 비용 (ExpenseModal, /api/trade-account/transactions)
//   고객기업 계좌 → 고객 차감 (CustomerDeductModal, /api/ft/user-transactions)
// ============================================================

/** 주문 요약 — 선택 모달과 두 기록 모달 상단에 공통으로 표시 */
export const CostOrderSummary: React.FC<{ order: InspectOrder }> = ({ order }) => (
  <div className="oi-cost-order">
    <div className="oi-cost-order-row">
      <span className="oi-cost-order-label">주문번호</span>
      <span className="oi-cost-order-no">{order.orderNo}</span>
    </div>
    <div className="oi-cost-order-row">
      <span className="oi-cost-order-label">판매자</span>
      <span>{order.shop || '-'}</span>
    </div>
    <div className="oi-cost-order-row">
      <span className="oi-cost-order-label">결제금액</span>
      <span className="oi-cost-order-amount">{order.amount || '-'}</span>
    </div>
    <div className="oi-cost-order-row">
      <span className="oi-cost-order-label">주문일시</span>
      <span>{order.orderedAt || '-'}</span>
    </div>
    {order.items.length > 0 && (
      <ul className="oi-cost-order-items">
        {order.items.map((it, i) => (
          <li key={i}>
            <span className="oi-cost-order-item">{it.detailKo || it.detail}</span>
            {it.qty && <span className="oi-cost-order-qty">× {it.qty}</span>}
          </li>
        ))}
      </ul>
    )}
  </div>
);

interface Props {
  order: InspectOrder;
  onPick: (target: CostTarget) => void;
  onClose: () => void;
}

const CostTargetModal: React.FC<Props> = ({ order, onPick, onClose }) => (
  <div className="oi-choice-overlay" onClick={onClose}>
    <div className="oi-choice-modal" role="dialog" aria-label="비용처리 대상 선택" onClick={(e) => e.stopPropagation()}>
      <h3 className="oi-choice-title">비용처리</h3>
      <p className="oi-choice-desc">이 주문의 결제금액을 어느 계좌에서 차감할지 고르세요.</p>

      <CostOrderSummary order={order} />

      <div className="oi-choice-options">
        <button type="button" className="oi-choice-option oi-choice-option--trade" onClick={() => onPick('trade')}>
          <span className="oi-choice-name">무역계좌</span>
          <span className="oi-choice-hint">회사 비용으로 기록 — 무역계좌 [회사 거래 추가]</span>
        </button>
        <button type="button" className="oi-choice-option oi-choice-option--customer" onClick={() => onPick('customer')}>
          <span className="oi-choice-name">고객기업 계좌</span>
          <span className="oi-choice-hint">고객 잔액에서 차감 — 고객계좌(신) [추가 › 차감]</span>
        </button>
      </div>

      <div className="oi-choice-actions">
        <button type="button" className="oi-choice-cancel" onClick={onClose}>취소</button>
      </div>
    </div>
  </div>
);

export default CostTargetModal;
