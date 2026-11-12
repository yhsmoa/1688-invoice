import React from 'react';
import { flowTotal, type OrderFlow, type OrderPending } from '../../../../lib/orderFlow';
import { FLOW_SEGMENTS, segmentQty } from '../utils/flowSegments';
import { nf, pctOf } from '../utils/orderDisplay';

// ============================================================
// OrderFlowBar — 주문수량 막대. 길이 = 수량, 색 = 어디까지 왔는지
//   [ 주문(실적): 입고완료 → 입고대기 → 미도착 → 취소·종결 ][ 주문요청 ][ 카트 ]
//   · 연한 바탕(track) 위에 그린다. 길이는 모두 maxQty 대비 비율 — 구간끼리 물량 비교
//   · 주문 묶음(.odm-flow) 안의 칸 너비는 그 안에서의 수량 비율 (칸의 합 = 주문수량)
//   · 주문요청·카트(잠재 주문량)는 아직 주문 전이라 주문 묶음 뒤에 이어 붙인다
//     — 오늘이 속한 구간의 행에만 pending 이 들어온다
//   · 막대에는 글자를 넣지 않는다 — 수치는 옆 열과 설명 카드(OrderFlowTooltip)가 담당.
// ============================================================

/** 스크린리더용 설명 — 칸별 수량과 비율 */
function describeFlow(flow: OrderFlow, total: number): string {
  const qty = segmentQty(flow);
  return FLOW_SEGMENTS.map((s) => `${s.label} ${nf(qty[s.key])}개 (${pctOf(qty[s.key], total) ?? 0}%)`).join(', ');
}

interface OrderFlowBarProps {
  flow: OrderFlow;
  /** 막대 길이 기준값 — 표에서 가장 큰 (주문수량 + 잠재 주문량) */
  maxQty: number;
  /** 이 구간에 얹을 잠재 주문량 (오늘이 속한 구간만, 그 외 null) */
  pending: OrderPending | null;
}

const OrderFlowBar: React.FC<OrderFlowBarProps> = ({ flow, maxQty, pending }) => {
  const total = flowTotal(flow);
  const qty = segmentQty(flow);
  const widthOf = (n: number) => (maxQty > 0 ? `${Math.min(Math.max((n / maxQty) * 100, 0), 100)}%` : '0%');

  return (
    <div className="odm-bar-track">
      {/* 주문(실적) — 진행 단계별 색 */}
      {total > 0 && (
        <div className="odm-flow" role="img" aria-label={describeFlow(flow, total)} style={{ width: widthOf(total) }}>
          {FLOW_SEGMENTS.map((s) =>
            qty[s.key] > 0 ? (
              <span key={s.key} className={`odm-flow-seg odm-flow-${s.key}`} style={{ flexGrow: qty[s.key] }} />
            ) : null,
          )}
        </div>
      )}
      {/* 잠재 주문량 — 주문요청 · 카트 */}
      {pending && pending.request.qty > 0 && (
        <span
          className="odm-bar-seg odm-seg-request"
          role="img"
          aria-label={`주문요청 ${nf(pending.request.qty)}개`}
          style={{ width: widthOf(pending.request.qty) }}
        />
      )}
      {pending && pending.cart.qty > 0 && (
        <span
          className="odm-bar-seg odm-seg-cart"
          role="img"
          aria-label={`카트 ${nf(pending.cart.qty)}개`}
          style={{ width: widthOf(pending.cart.qty) }}
        />
      )}
    </div>
  );
};

export default OrderFlowBar;
