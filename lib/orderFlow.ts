// ============================================================
// 주문 진행 현황 — 공용 타입·helper
//   집계 : supabase/db/003_order_flow.sql (rpc db_order_flow)
//   API  : app/api/db/order-weekly/route.ts
//   화면 : app/db/orders/OrderDataManage.tsx
//
// 진행 순서: 주문 → 배송완료(1688) → 입고 → 출고
//   주문수량을 아래 6칸으로 겹치지 않게 나눈다 (6칸의 합 = 주문수량).
//   칸의 정의·우선순위는 SQL 파일 머리말 참고.
// ============================================================

import { periodEndOf, periodStartOf, toKstDate, type PeriodUnit } from './periodBucket';

// ── 진행 수량 6칸 ──
export interface OrderFlow {
  /** 입고완료 — ARRIVAL 수량 (주문수량까지만) */
  arrivedQty: number;
  /** 입고대기 — 1688 배송완료 기록은 있고 아직 입고 전 */
  waitingQty: number;
  /** 미도착 — 1688 배송완료 기록 없음 (배송 전·배송 중·기록 없음) */
  undeliveredQty: number;
  /** 취소 완료 (입고 전 취소) */
  cancelDoneQty: number;
  /** 취소 접수중 (입고 전 취소, 아직 완료 전) */
  cancelPendingQty: number;
  /** 입고 기록 없이 완료(DONE) 처리된 수량 */
  closedQty: number;
}

export const FLOW_KEYS = [
  'arrivedQty',
  'waitingQty',
  'undeliveredQty',
  'cancelDoneQty',
  'cancelPendingQty',
  'closedQty',
] as const satisfies readonly (keyof OrderFlow)[];

export const emptyFlow = (): OrderFlow => ({
  arrivedQty: 0,
  waitingQty: 0,
  undeliveredQty: 0,
  cancelDoneQty: 0,
  cancelPendingQty: 0,
  closedQty: 0,
});

/** target 에 src 를 더한다 */
export const addFlow = (target: OrderFlow, src: OrderFlow): void => {
  for (const k of FLOW_KEYS) target[k] += src[k];
};

/** 6칸의 합 — 주문수량과 같다 */
export const flowTotal = (f: OrderFlow): number => FLOW_KEYS.reduce((n, k) => n + f[k], 0);

/** 미입고 잔량 — 앞으로 들어올 수량 (입고대기 + 미도착) */
export const flowRemainingQty = (f: OrderFlow): number => f.waitingQty + f.undeliveredQty;

/** 들어오지 않는 수량 — 취소(완료·접수중) + 입고 기록 없이 종결 */
export const flowClosedQty = (f: OrderFlow): number =>
  f.cancelDoneQty + f.cancelPendingQty + f.closedQty;

// ── API 응답 ──
export type OrderPeriod = PeriodUnit;

/** 구간 1행 (필드명 weekStart/weekEnd 는 주간 전용 시절 이름을 유지 — 일/월도 같은 칸을 쓴다) */
export interface OrderPeriodRow extends OrderFlow {
  weekStart: string;
  weekEnd: string;
  orderCount: number;
  userCount: number;
  itemRows: number;
  qty: number;
  coupangQty: number;
  personalQty: number;
  directQty: number;
  doneQty: number;
  /** 주문 금액 (CNY, 소수 2자리까지 정확) — 표시할 때 반올림한다 */
  amountCny: number;
}

/**
 * 금액(CNY) → 정수 分(1/100).
 *   금액은 반드시 分 단위 정수로 더한다. 소수로 더하면 누적 오차가 생기고,
 *   구간별로 반올림한 뒤 더하면 일/주/월 단위에 따라 합계가 달라진다.
 */
export const toCnyCents = (amountCny: number): number => Math.round(amountCny * 100);

/** 구간들의 주문 금액 합계 (CNY) — 단위(일/주/월)와 무관하게 같은 값 */
export const sumAmountCny = (rows: readonly { amountCny: number }[]): number =>
  rows.reduce((cents, r) => cents + toCnyCents(r.amountCny), 0) / 100;

// ── 잠재 주문량 — 아직 ft_orders 로 넘어오지 않은 고객 카트 ──
export interface PendingStat {
  carts: number;
  items: number;
  qty: number;
}

export interface OrderPending {
  /** 잠재 주문량이 얹히는 구간 = 오늘이 속한 구간 */
  periodStart: string;
  /** 주문요청 — ft_carts.status = 'ORDER' */
  request: PendingStat;
  /** 카트 — ft_carts.status = 'NEW' */
  cart: PendingStat;
}

/** 잠재 주문량 합계 (주문요청 + 카트) */
export const pendingTotalQty = (p: OrderPending | null | undefined): number =>
  p ? p.request.qty + p.cart.qty : 0;

export interface OrderWeeklyMeta {
  weekCount: number;
  orderRows: number;
  itemRows: number;
  orphanItems: number;
  headerQtyMismatch: number;
  /** 마지막 배송상황 CSV 업로드 시각 — 배송완료(입고대기) 판정의 기준 시점 */
  lastDeliveryUploadAt: string | null;
}

// ============================================================
// 집계 — rpc db_order_flow 결과(주문별 합계)를 기간 버킷으로 묶는다
//   · 구간 기준일 : ft_orders.created_at (KST 변환)
//   · 순수 함수 (DB 접근 없음) — API 라우트가 호출한다
// ============================================================

/** rpc db_order_flow 의 주문 1건 (supabase/db/003_order_flow.sql 반환 형태) */
export interface OrderFlowRpcOrder {
  id: string;
  created_at: string | null;
  user_id: string | null;
  total_qty: number | null;
  item_rows: number;
  qty: number;
  coupang_qty: number;
  personal_qty: number;
  direct_qty: number;
  done_qty: number;
  amount_cny: number | string;
  arrived_qty: number;
  waiting_qty: number;
  undelivered_qty: number;
  cancel_done_qty: number;
  cancel_pending_qty: number;
  closed_qty: number;
}

export interface OrderFlowRpcResult {
  orders: OrderFlowRpcOrder[];
  /** 주문(ft_orders)이 없는 품목 수 */
  orphan_items: number;
  last_delivery_upload_at: string | null;
}

interface PeriodAcc extends OrderFlow {
  periodStart: string;
  orderCount: number;
  userIds: Set<string>;
  itemRows: number;
  qty: number;
  coupangQty: number;
  personalQty: number;
  directQty: number;
  doneQty: number;
  /** 정수 分 */
  amountCents: number;
}

const num = (v: number | string | null | undefined): number => Number(v) || 0;

/**
 * @param ensurePeriodStart 주문이 없어도 행을 만들 구간 시작일
 *   (잠재 주문량을 얹을 "오늘이 속한 구간" — 그 구간에 아직 주문이 없을 수 있다)
 */
export function buildOrderPeriods(
  rpc: OrderFlowRpcResult,
  period: OrderPeriod,
  ensurePeriodStart?: string,
): { weeks: OrderPeriodRow[]; meta: OrderWeeklyMeta } {
  const buckets = new Map<string, PeriodAcc>();

  const bucketOf = (periodStart: string): PeriodAcc => {
    let b = buckets.get(periodStart);
    if (!b) {
      b = {
        periodStart,
        orderCount: 0,
        userIds: new Set(),
        itemRows: 0,
        qty: 0,
        coupangQty: 0,
        personalQty: 0,
        directQty: 0,
        doneQty: 0,
        amountCents: 0,
        ...emptyFlow(),
      };
      buckets.set(periodStart, b);
    }
    return b;
  };

  // 생성일이 없는 주문은 어느 구간에도 넣을 수 없다 → 그 품목은 제외 건수로 센다
  let orphanItems = num(rpc.orphan_items);
  let itemRowsAll = num(rpc.orphan_items);
  let headerQtyMismatch = 0;

  for (const o of rpc.orders) {
    const itemRows = num(o.item_rows);
    const qty = num(o.qty);
    itemRowsAll += itemRows;

    // 헤더 수량(ft_orders.total_qty) 불일치 검증 — 집계는 품목 기준
    if (num(o.total_qty) !== qty) headerQtyMismatch += 1;

    if (!o.created_at) {
      orphanItems += itemRows;
      continue;
    }

    const b = bucketOf(periodStartOf(toKstDate(o.created_at), period));

    // 품목이 하나도 없는 주문도 주문 건수에는 포함 (rpc 가 0 으로 채워 준다)
    b.orderCount += 1;
    if (o.user_id) b.userIds.add(o.user_id);
    b.itemRows += itemRows;
    b.qty += qty;
    b.coupangQty += num(o.coupang_qty);
    b.personalQty += num(o.personal_qty);
    b.directQty += num(o.direct_qty);
    b.doneQty += num(o.done_qty);
    b.amountCents += toCnyCents(num(o.amount_cny));
    addFlow(b, {
      arrivedQty: num(o.arrived_qty),
      waitingQty: num(o.waiting_qty),
      undeliveredQty: num(o.undelivered_qty),
      cancelDoneQty: num(o.cancel_done_qty),
      cancelPendingQty: num(o.cancel_pending_qty),
      closedQty: num(o.closed_qty),
    });
  }

  if (ensurePeriodStart) bucketOf(ensurePeriodStart);

  // 최신 구간 먼저
  const weeks: OrderPeriodRow[] = Array.from(buckets.values())
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
    .map((b) => ({
      weekStart: b.periodStart,
      weekEnd: periodEndOf(b.periodStart, period),
      orderCount: b.orderCount,
      userCount: b.userIds.size,
      itemRows: b.itemRows,
      qty: b.qty,
      coupangQty: b.coupangQty,
      personalQty: b.personalQty,
      directQty: b.directQty,
      doneQty: b.doneQty,
      amountCny: b.amountCents / 100,
      arrivedQty: b.arrivedQty,
      waitingQty: b.waitingQty,
      undeliveredQty: b.undeliveredQty,
      cancelDoneQty: b.cancelDoneQty,
      cancelPendingQty: b.cancelPendingQty,
      closedQty: b.closedQty,
    }));

  return {
    weeks,
    meta: {
      weekCount: weeks.length,
      orderRows: rpc.orders.length,
      itemRows: itemRowsAll,
      orphanItems,
      headerQtyMismatch,
      lastDeliveryUploadAt: rpc.last_delivery_upload_at ?? null,
    },
  };
}
