// ============================================================
// 주문누락? 판정 — "이 프로젝트는 아직 받을 물건으로 보는데, 1688 에서는 끝난 주문"
//
// 항목(ft_order_items 행) 단위로 판정한다. 1688 주문상태(엑셀 J열 订单状态)는
// 주문 단위 값이라, 1688 주문 하나에 여러 항목이 있으면 각 행을 따로 본다.
//
// 기준:
//   1688 주문상태가 交易关闭(거래 종료) 또는 退款中(환불 중) 이고
//   남은 수량 = 주문 − 취소 − 반품 − 입고 > 0
//   → 입고도 안 됐고 취소·반품 처리도 안 된 수량이 남아 있음
//
// 제외: 항목 DONE / 엑셀에 없는 주문
//
// 退款中 은 주문 안의 일부 상품만 환불 중일 수 있어, 문구로 그 점을 알린다.
// 판정은 [1688 XLSX] 를 마지막으로 올린 시점 기준이다.
// ============================================================

// ── 대상 1688 주문상태 → 화면 표기 ──
export const ORDER_MISSING_STATUSES: Record<string, string> = {
  交易关闭: '거래 종료',
  退款中: '환불 중',
};

export interface OrderMissing {
  /** 해당한 1688 주문상태 (원문) */
  status: string;
  /** 입고·취소·반품 어디에도 안 잡힌 수량 */
  remainingQty: number;
  /** 툴팁 문구 — 왜 걸렸는지 */
  message: string;
}

export interface OrderMissingInput {
  /** 1688 주문상태 목록 (엑셀 J열) — 엑셀에 없으면 undefined */
  statuses: string[] | undefined;
  itemStatus: string | null;
  orderQty: number | null;
  arrivalQty: number;
  cancelQty: number;
  returnQty: number;
}

export function evaluateOrderMissing(input: OrderMissingInput): OrderMissing | null {
  if (input.itemStatus === 'DONE') return null;

  const status = input.statuses?.find((s) => s in ORDER_MISSING_STATUSES);
  if (!status) return null;

  const remainingQty = (input.orderQty ?? 0) - input.cancelQty - input.returnQty - input.arrivalQty;
  if (remainingQty <= 0) return null;

  const label = ORDER_MISSING_STATUSES[status];
  const note = status === '退款中' ? '\n(주문 안의 일부 상품만 환불 중일 수 있음)' : '';
  return {
    status,
    remainingQty,
    message:
      `1688 주문상태: ${status} (${label})\n` +
      `입고·취소·반품 처리 안 된 수량 ${remainingQty}개 — 취소 누락인지 확인 필요${note}`,
  };
}
