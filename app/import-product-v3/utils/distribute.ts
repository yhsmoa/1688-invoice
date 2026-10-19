// ============================================================
// 상품입고 V3 — 옵션 수량 배분 (순수 함수)
//
// 옵션에 "10" 을 입력하면 그 옵션의 주문행을 순서대로 채운다.
//   · 행마다 잔여(order_qty − 입고 − 취소)까지만 채우고 다음 행으로 넘어간다
//     (주문 2 인 행은 2 까지)
//   · 잔여 0 행은 건너뛴다
//   · 다 채우고도 남으면 overflow > 0 → 호출 측이 적용을 거부한다
//     (일부만 들어가는 걸 작업자가 못 알아채는 편이 더 위험하다)
// ============================================================

export interface DistributeRow {
  id: string;
  remaining: number;
}

export interface DistributeResult {
  /** 행 id → 배분 수량 (0 인 행은 키 없음) */
  alloc: Map<string, number>;
  /** 배분하지 못한 수량 — 0 보다 크면 입력이 잔여 합을 넘은 것 */
  overflow: number;
}

export function distribute(rows: DistributeRow[], qty: number): DistributeResult {
  const alloc = new Map<string, number>();
  let left = Math.max(0, Math.floor(qty));

  for (const row of rows) {
    if (left <= 0) break;
    if (row.remaining <= 0) continue;
    const take = Math.min(row.remaining, left);
    alloc.set(row.id, take);
    left -= take;
  }

  return { alloc, overflow: left };
}
