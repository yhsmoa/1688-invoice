'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  flowRemainingQty,
  pendingTotalQty,
  type OrderPending,
  type OrderPeriod,
  type OrderPeriodRow,
} from '../../../../lib/orderFlow';
import { FLOW_SEGMENTS } from '../utils/flowSegments';
import {
  PERIOD_COLUMN,
  PERIOD_CURRENT,
  kstDateTime,
  nf,
  pctOf,
  periodLabel,
  periodRange,
} from '../utils/orderDisplay';
import OrderFlowBar from './OrderFlowBar';
import OrderFlowTooltip, { type TooltipAnchor } from './OrderFlowTooltip';

// ============================================================
// OrderPeriodTable — 구간(일/주/월)별 주문량 + 진행 현황 표
//   주문수량 막대: 길이 = 수량, 색 = 진행 단계 (입고완료 / 입고대기 / 미도착 / 취소·종결)
//     + 오늘이 속한 구간에는 잠재 주문량(주문요청 · 카트)을 이어 붙인다
//   막대 옆 열에 단계별 수량을 숫자로 함께 보여준다
//   주문수량 칸에 마우스를 올리면(또는 키보드 포커스) 설명 카드가 뜬다
// ============================================================

interface OrderPeriodTableProps {
  rows: OrderPeriodRow[];
  period: OrderPeriod;
  /** 잠재 주문량 — pending.periodStart 구간의 행에만 얹는다 */
  pending: OrderPending | null;
  /** 마지막 배송상황 CSV 업로드 시각 — 입고대기/미도착을 가르는 기준 시점 */
  lastDeliveryUploadAt: string | null;
}

/** 수량 + (비중%) — 배송유형·입고완료 열 공용 */
const QtyWithPct: React.FC<{ qty: number; total: number }> = ({ qty, total }) => {
  const pct = pctOf(qty, total);
  return (
    <>
      {nf(qty)}
      {pct !== null && <span className="odm-pct"> ({pct}%)</span>}
    </>
  );
};

/** 0 은 흐리게 — 남은 수량이 있는 행만 눈에 띄도록 */
const qtyClass = (qty: number) => (qty > 0 ? '' : ' odm-muted');

const OrderPeriodTable: React.FC<OrderPeriodTableProps> = ({ rows, period, pending, lastDeliveryUploadAt }) => {
  // ── 잠재 주문량 (주문요청 + 카트) — 오늘이 속한 구간 행에만 얹는다 ──
  const pendingQty = pendingTotalQty(pending);
  const pendingOf = (weekStart: string): OrderPending | null =>
    pending && pendingQty > 0 && pending.periodStart === weekStart ? pending : null;

  // 막대 길이 기준값 (주문수량 + 그 행의 잠재 주문량 중 최대)
  const maxQty = rows.reduce((m, w) => Math.max(m, w.qty + pendingTotalQty(pendingOf(w.weekStart))), 0);

  // ── 설명 카드 — 마우스를 올린 구간(weekStart) 과 그 칸의 화면 좌표 ──
  const [tip, setTip] = useState<{ key: string; anchor: TooltipAnchor } | null>(null);

  const showTip = useCallback((key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ key, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // 카드는 화면 좌표에 고정돼 있어 스크롤하면 칸과 어긋난다 → 스크롤 시 닫는다
  useEffect(() => {
    if (!tip) return;
    window.addEventListener('scroll', hideTip, true);
    return () => window.removeEventListener('scroll', hideTip, true);
  }, [tip, hideTip]);

  const tipRow = tip ? rows.find((w) => w.weekStart === tip.key) : undefined;

  return (
    <>
      {/* ── 주문수량 막대 색 범례 ── */}
      <div className="odm-legend">
        <span className="odm-legend-title">주문수량 막대</span>
        {FLOW_SEGMENTS.map((s) => (
          <span key={s.key} className="odm-legend-item" title={s.hint}>
            <span className={`odm-legend-swatch odm-flow-${s.key}`} />
            {s.label}
            <span className="odm-legend-hint">{s.hint}</span>
          </span>
        ))}
        <span className="odm-legend-sep" />
        <span className="odm-legend-item">
          <span className="odm-legend-swatch odm-seg-request" />
          주문요청
        </span>
        <span className="odm-legend-item">
          <span className="odm-legend-swatch odm-seg-cart" />
          카트
          <span className="odm-legend-hint">
            아직 주문 전인 잠재 주문량 · {PERIOD_CURRENT[period]} 막대에 이어 표시
          </span>
        </span>
        <span className="odm-legend-note">
          배송완료 기준: 배송상황 업로드{' '}
          {lastDeliveryUploadAt ? kstDateTime(lastDeliveryUploadAt) : '기록 없음'}
        </span>
      </div>

      {/* ── 표 ── */}
      <div className="odm-table-wrap">
        <table className="odm-table">
          <thead>
            <tr>
              <th className="odm-col-week">{PERIOD_COLUMN[period]}</th>
              <th className="odm-col-range">기간</th>
              <th className="odm-col-num">주문건수</th>
              <th className="odm-col-num">품목수</th>
              <th className="odm-col-bar">주문수량</th>
              <th className="odm-col-type">입고완료</th>
              <th className="odm-col-stage" title="1688 배송완료 · 아직 입고 전">입고대기</th>
              <th className="odm-col-stage" title="배송 전 · 배송 중">미도착</th>
              <th className="odm-col-stage" title="입고대기 + 미도착">미입고 계</th>
              <th className="odm-col-type">쿠팡</th>
              <th className="odm-col-type">개인통관</th>
              <th className="odm-col-type">직배송</th>
              <th className="odm-col-num">금액(CNY)</th>
              <th className="odm-col-num">완료율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const donePct = pctOf(w.doneQty, w.qty);
              const remaining = flowRemainingQty(w);
              const p = pendingOf(w.weekStart);
              return (
                <tr key={w.weekStart} className={p ? 'odm-row-pending' : undefined}>
                  <td className="odm-col-week">{periodLabel(w.weekStart, period)}</td>
                  <td className="odm-col-range">{periodRange(w.weekStart, w.weekEnd, period)}</td>
                  <td className="odm-col-num">{nf(w.orderCount)}</td>
                  <td className="odm-col-num odm-muted">{nf(w.itemRows)}</td>
                  {/* 주문수량 — 막대 길이는 물량, 색은 진행 단계 (+ 잠재 주문량). 올리면 설명 카드 */}
                  <td className="odm-col-bar">
                    <div
                      className="odm-bar-wrap"
                      tabIndex={0}
                      onMouseEnter={(e) => showTip(w.weekStart, e.currentTarget)}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTip(w.weekStart, e.currentTarget)}
                      onBlur={hideTip}
                    >
                      <div className="odm-bar-cell">
                        <span className="odm-bar-value">{nf(w.qty)}</span>
                        <OrderFlowBar flow={w} maxQty={maxQty} pending={p} />
                      </div>
                      {p && (
                        <div className="odm-bar-pending">
                          <span className="odm-pending-request">주문요청 +{nf(p.request.qty)}</span>
                          <span className="odm-pending-cart">카트 +{nf(p.cart.qty)}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  {/* 단계별 수량 (입고완료는 주문수량 대비 비중 표시) */}
                  <td className="odm-col-type">
                    <QtyWithPct qty={w.arrivedQty} total={w.qty} />
                  </td>
                  <td className={`odm-col-stage${qtyClass(w.waitingQty)}`}>{nf(w.waitingQty)}</td>
                  <td className={`odm-col-stage${qtyClass(w.undeliveredQty)}`}>{nf(w.undeliveredQty)}</td>
                  <td className={`odm-col-stage${qtyClass(remaining)}`}>
                    {remaining > 0 ? <span className="odm-progress">{nf(remaining)}</span> : nf(remaining)}
                  </td>
                  {/* 배송유형 — 수량 옆에 해당 구간 주문수량 대비 비중 표시 */}
                  <td className="odm-col-type">
                    <QtyWithPct qty={w.coupangQty} total={w.qty} />
                  </td>
                  <td className="odm-col-type">
                    <QtyWithPct qty={w.personalQty} total={w.qty} />
                  </td>
                  <td className="odm-col-type odm-muted">
                    <QtyWithPct qty={w.directQty} total={w.qty} />
                  </td>
                  <td className="odm-col-num odm-muted">{nf(Math.round(w.amountCny))}</td>
                  <td className="odm-col-num">
                    {donePct !== null ? (
                      <span className={donePct >= 99.9 ? 'odm-done' : 'odm-progress'}>{donePct}%</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── 설명 카드 (document.body 로 portal) ── */}
      {tip && tipRow && (
        <OrderFlowTooltip
          row={tipRow}
          title={periodLabel(tipRow.weekStart, period)}
          anchor={tip.anchor}
          pending={pendingOf(tipRow.weekStart)}
        />
      )}
    </>
  );
};

export default OrderPeriodTable;
