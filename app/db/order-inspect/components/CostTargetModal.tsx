'use client';

import React from 'react';
import type { CostTarget, InspectOrder } from '../types';

// ============================================================
// CostTargetModal — [비용처리] 1단계: 결제금액을 누가 부담하는지 고른다
//
//   통장(무역계좌) 출금은 양쪽 모두 같다. 차이는 몫의 구분뿐:
//   회사 부담 → 회사자산 − · 손익 −  (ExpenseModal, /api/trade-account/transactions)
//   고객 부담 → 고객 충전금 −        (CustomerDeductModal, /api/ft/user-transactions)
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
  // 바깥 클릭으로는 닫지 않는다 — [취소] 로만 닫기 (비용처리 흐름의 모달 공통)
  <div className="oi-choice-overlay">
    <div className="oi-choice-modal" role="dialog" aria-label="비용처리 대상 선택">
      <h3 className="oi-choice-title">비용처리</h3>
      <p className="oi-choice-desc">이 주문의 결제금액을 누가 부담하는지 고르세요. 통장 출금은 양쪽 모두 같습니다.</p>

      <CostOrderSummary order={order} />

      <div className="oi-choice-options">
        <button type="button" className="oi-choice-option oi-choice-option--trade" onClick={() => onPick('trade')}>
          <span className="oi-choice-name">회사 부담 (회사자산 −)</span>
          <span className="oi-choice-hint">소모품 등 회사 경비로 기록 · 손익에 반영</span>
        </button>
        <button type="button" className="oi-choice-option oi-choice-option--customer" onClick={() => onPick('customer')}>
          <span className="oi-choice-name">고객 부담 (고객 충전금 −)</span>
          <span className="oi-choice-hint">해당 고객의 충전금에서 차감 · 회사자산 변동 없음</span>
        </button>
      </div>

      <div className="oi-choice-actions">
        <button type="button" className="oi-choice-cancel" onClick={onClose}>취소</button>
      </div>
    </div>
  </div>
);

export default CostTargetModal;
