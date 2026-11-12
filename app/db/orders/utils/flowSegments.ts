import { flowClosedQty, type OrderFlow } from '../../../../lib/orderFlow';

// ============================================================
// 주문수량 막대의 칸 정의 — 막대·범례·설명 카드가 같은 목록을 쓴다
//   순서 = 진행이 많이 된 순서 (막대 왼쪽 → 오른쪽)
//   색은 OrderDataManage.css 의 .odm-flow-{key}
// ============================================================

export const FLOW_SEGMENTS = [
  { key: 'arrived', label: '입고완료', hint: '입고 처리된 수량' },
  { key: 'waiting', label: '입고대기', hint: '1688 배송완료 · 아직 입고 전' },
  { key: 'undelivered', label: '미도착', hint: '배송 전 · 배송 중' },
  { key: 'closed', label: '취소·종결', hint: '취소 · 입고 기록 없이 완료' },
] as const;

export type FlowSegmentKey = (typeof FLOW_SEGMENTS)[number]['key'];

/** 칸별 수량 — 4칸의 합 = 주문수량 */
export const segmentQty = (flow: OrderFlow): Record<FlowSegmentKey, number> => ({
  arrived: flow.arrivedQty,
  waiting: flow.waitingQty,
  undelivered: flow.undeliveredQty,
  closed: flowClosedQty(flow),
});
