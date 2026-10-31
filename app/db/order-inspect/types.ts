// ============================================================
// 주문 검사 — 화면 공용 타입 (/api/db/order-inspect 응답과 동일 구조)
// ============================================================

export interface InspectItem {
  detail: string;     // S열 원문(중국어)
  detailKo: string;   // 한국어 번역 (번역 실패 시 원문)
  qty: string;        // U열 수량 표시값
}

export type StatusTone = 'active' | 'refund' | 'cancel' | 'etc';

export interface InspectOrder {
  orderNo: string;
  shop: string;
  amount: string;     // I열 결제금액 표시값
  status: string;
  statusKo: string;
  statusTone: StatusTone;
  orderedAt: string;  // K열 주문일시 표시값
  receiver: string;
  memo: string;
  items: InspectItem[];
  /** 이미 두 원장에 기록된 비용처리 (서버가 참조키·1688 주문번호로 조회). 없으면 [] */
  recorded: CostTarget[];
}

export interface Summary {
  totalOrders: number;
  matchedOrders: number;
  unmatchedOrders: number;
  totalItemRows: number;
  unmatchedItemRows: number;
}

/** 비용처리 부담 주체 — 회사 부담(회사자산 −) / 고객 부담(고객 충전금 −). 통장 출금은 동일 */
export type CostTarget = 'trade' | 'customer';

export const COST_TARGET_LABEL: Record<CostTarget, string> = {
  trade: '회사 부담',
  customer: '고객 부담',
};
