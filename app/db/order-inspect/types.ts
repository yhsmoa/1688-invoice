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
}

export interface Summary {
  totalOrders: number;
  matchedOrders: number;
  unmatchedOrders: number;
  totalItemRows: number;
  unmatchedItemRows: number;
}

/** 비용처리 대상 — 무역계좌(회사 비용) / 고객기업 계좌(고객 차감) */
export type CostTarget = 'trade' | 'customer';

export const COST_TARGET_LABEL: Record<CostTarget, string> = {
  trade: '회사 부담',
  customer: '고객 부담',
};
