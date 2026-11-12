import React from 'react';
import {
  flowRemainingQty,
  pendingTotalQty,
  type OrderFlow,
  type OrderPending,
  type OrderPeriod,
} from '../../../../lib/orderFlow';
import { PERIOD_UNIT, nf, pctOf } from '../utils/orderDisplay';

// ============================================================
// OrderSummaryCards — 조회된 전체 구간의 합계 카드
//   잠재 주문량(주문요청·카트)은 아직 주문이 아니므로 합계·평균·비중에 넣지 않고
//   마지막 카드에 따로 보여준다.
// ============================================================

export interface OrderTotals extends OrderFlow {
  qty: number;
  orderCount: number;
  itemRows: number;
  coupangQty: number;
  /** 주문 금액 합계 (CNY, 소수 포함) — 표시할 때 반올림 */
  amountCny: number;
  /** 구간(일/주/월)당 평균 주문수량 — 주문이 있는 구간만 센다 */
  avgQtyPerPeriod: number;
}

interface OrderSummaryCardsProps {
  totals: OrderTotals;
  period: OrderPeriod;
  /** 주문이 있는 구간 수 (평균의 분모) */
  periodCount: number;
  pending: OrderPending | null;
}

/** 평균 카드의 구간 수 표기 — 주문이 없는 날/주/월은 평균에서 빠진다 */
const periodCountLabel = (period: OrderPeriod, count: number): string => {
  if (period === 'day') return `주문 있는 날 ${nf(count)}일`;
  return period === 'month' ? `${nf(count)}개월` : `${nf(count)}주`;
};

const OrderSummaryCards: React.FC<OrderSummaryCardsProps> = ({ totals, period, periodCount, pending }) => {
  const unit = PERIOD_UNIT[period];

  return (
    <div className="odm-summary">
      <div className="odm-sum-card">
        <span className="odm-sum-label">총 주문수량</span>
        <span className="odm-sum-value">{nf(totals.qty)}</span>
        <span className="odm-sum-unit">개 · 품목 {nf(totals.itemRows)}건</span>
      </div>
      {/* 미입고 잔량 — 주문한 것 중 앞으로 들어올 수량 (입고대기 + 미도착). 색 점 = 막대 색 */}
      <div className="odm-sum-card">
        <span className="odm-sum-label">미입고 잔량</span>
        <span className="odm-sum-value">{nf(flowRemainingQty(totals))}</span>
        <span className="odm-sum-unit">
          <i className="odm-sum-dot odm-flow-waiting" />
          입고대기 {nf(totals.waitingQty)}
          <i className="odm-sum-dot odm-flow-undelivered" />
          미도착 {nf(totals.undeliveredQty)}
        </span>
      </div>
      <div className="odm-sum-card">
        <span className="odm-sum-label">총 주문건수</span>
        <span className="odm-sum-value">{nf(totals.orderCount)}</span>
        <span className="odm-sum-unit">건</span>
      </div>
      <div className="odm-sum-card odm-sum-card-accent">
        <span className="odm-sum-label">{unit} 평균 주문량</span>
        <span className="odm-sum-value">{nf(totals.avgQtyPerPeriod)}</span>
        <span className="odm-sum-unit">
          개 / {unit} · {periodCountLabel(period, periodCount)}
        </span>
      </div>
      <div className="odm-sum-card">
        <span className="odm-sum-label">쿠팡 비중</span>
        <span className="odm-sum-value">
          {pctOf(totals.coupangQty, totals.qty) ?? 0}
          <span className="odm-sum-pct">%</span>
        </span>
        <span className="odm-sum-unit">{nf(totals.coupangQty)}개</span>
      </div>
      <div className="odm-sum-card odm-sum-card-accent2">
        <span className="odm-sum-label">주문 금액</span>
        <span className="odm-sum-value">{nf(Math.round(totals.amountCny))}</span>
        <span className="odm-sum-unit">CNY</span>
      </div>
      {pending && (
        <div className="odm-sum-card odm-sum-card-pending">
          <span className="odm-sum-label">잠재 주문량 (미주문)</span>
          <span className="odm-sum-value">{nf(pendingTotalQty(pending))}</span>
          <span className="odm-sum-unit">
            주문요청 {nf(pending.request.qty)} · 카트 {nf(pending.cart.qty)}
          </span>
        </div>
      )}
    </div>
  );
};

export default OrderSummaryCards;
