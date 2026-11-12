import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { parsePeriodUnit, periodStartOf, toKstDate } from '../../../../lib/periodBucket';
import { guardDbRoute } from '../../../../lib/dbAccess';
import {
  buildOrderPeriods,
  pendingTotalQty,
  type OrderFlowRpcResult,
  type OrderPending,
  type OrderPeriod,
  type PendingStat,
} from '../../../../lib/orderFlow';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/db/order-weekly?period=day|week|month
//
// 일간 / 주간(월~일) / 월간 단위 주문 집계 + 진행 현황
//   집계: rpc db_order_flow (supabase/db/003_order_flow.sql)
//     · ft_order_items 4만 행 초과 → 행을 내려받지 않고 DB 에서 주문별로 한 번에 집계
//     · 반환은 jsonb 1개 (PostgREST 1000행 응답 제한 회피)
//     · 한 문장(단일 스냅샷)이라 주문수량과 진행 수량이 서로 어긋나지 않는다
//   기간 버킷: lib/orderFlow.buildOrderPeriods (기준 = ft_orders.created_at, KST)
//
//   · 주문 수량   : ft_order_items.order_qty 합
//       ※ ft_orders.total_qty 는 품목 합계와 불일치하는 주문이 있어
//         신뢰하지 않고 품목 기준으로 집계한다.
//         불일치 건수는 meta.headerQtyMismatch 로 함께 반환.
//   · 배송유형    : ft_order_items.shipment_type (COUPANG / PERSONAL / DIRECT)
//   · 진행상태    : ft_order_items.status (DONE / 그 외 = 진행중)
//   · 진행 현황   : 입고완료 / 입고대기(배송완료) / 미도착 / 취소 / 기록 없이 종결
//                   — 6칸의 합 = 주문수량 (정의는 SQL 파일 머리말)
//
// 잠재 주문량 (pending) — 아직 ft_orders 로 넘어오지 않은 고객 카트
//   · 주문요청 : ft_carts.status = 'ORDER' (고객이 [주문] 했고 프로그램이 아직 안 불러옴)
//   · 카트     : ft_carts.status = 'NEW'   (고객 장바구니, 편집 중)
//   · 'DONE' 카트는 이미 ft_orders 로 전환됐으므로 제외 (이중 집계 방지)
//   · 불러오면 그 시점이 ft_orders.created_at 이 되므로 "오늘이 속한 구간"에 얹는다.
//
// ⚠️ ft_carts 643 / ft_cart_items 3.1만 (2026-11-02, NEW 3 · ORDER 9 카트)
//    → 카트·품목 모두 range 루프 + 카트 id 100개 단위 in() 조회
// ============================================================

const PAGE = 1000;
const ID_CHUNK = 100;
const PENDING_CART_STATUSES = ['ORDER', 'NEW'] as const;
type PendingCartStatus = (typeof PENDING_CART_STATUSES)[number];

// ── 잠재 주문 카트 (status ORDER / NEW) — id 정렬 range 루프 ──
type CartRow = { id: string; status: PendingCartStatus };
type CartItemRow = { id: string; cart_id: string; order_qty: number | null };

async function fetchPendingCarts(): Promise<CartRow[]> {
  const rows: CartRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ft_carts')
      .select('id, status')
      .in('status', [...PENDING_CART_STATUSES])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as CartRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ── 카트별 품목 (카트 id 100개 단위 × id 정렬 range 루프) ──
async function fetchCartItems(cartIds: string[]): Promise<CartItemRow[]> {
  const rows: CartItemRow[] = [];
  for (let c = 0; c < cartIds.length; c += ID_CHUNK) {
    const ids = cartIds.slice(c, c + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_cart_items')
        .select('id, cart_id, order_qty')
        .in('cart_id', ids)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as CartItemRow[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

// ── 잠재 주문량 집계 (상태별 카트 수 · 품목 수 · 수량) ──
async function loadPending(): Promise<Record<'request' | 'cart', PendingStat>> {
  const carts = await fetchPendingCarts();
  const items = carts.length > 0 ? await fetchCartItems(carts.map((c) => c.id)) : [];

  const result = {
    request: { carts: 0, items: 0, qty: 0 },
    cart: { carts: 0, items: 0, qty: 0 },
  };
  const keyOf = (s: PendingCartStatus) => (s === 'ORDER' ? 'request' : 'cart');

  const statusById = new Map<string, PendingCartStatus>();
  carts.forEach((c) => {
    statusById.set(c.id, c.status);
    result[keyOf(c.status)].carts += 1;
  });
  items.forEach((it) => {
    const s = statusById.get(it.cart_id);
    if (!s) return;
    result[keyOf(s)].items += 1;
    result[keyOf(s)].qty += it.order_qty ?? 0;
  });
  return result;
}

export async function GET(request: NextRequest) {
  try {
    // ── 접근 권한 검증 (DB 관리 메뉴 전용) ──
    const denied = await guardDbRoute(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const period: OrderPeriod = parsePeriodUnit(searchParams.get('period'));

    // ── 1. 주문별 합계 (DB 집계) + 잠재 주문량 ──
    const [flowRes, pendingStat] = await Promise.all([supabase.rpc('db_order_flow'), loadPending()]);
    if (flowRes.error) throw flowRes.error;

    const rpc = flowRes.data as OrderFlowRpcResult | null;
    if (!rpc || !Array.isArray(rpc.orders)) {
      throw new Error('db_order_flow 응답 형식이 올바르지 않습니다.');
    }

    // 잠재 주문량이 얹힐 "오늘이 속한 구간" — 아직 주문이 없는 구간이어도 행을 만든다
    const pending: OrderPending = {
      periodStart: periodStartOf(toKstDate(new Date().toISOString()), period),
      request: pendingStat.request,
      cart: pendingStat.cart,
    };

    // ── 2. 기간 버킷 (최신 구간 먼저) ──
    const { weeks, meta } = buildOrderPeriods(
      rpc,
      period,
      pendingTotalQty(pending) > 0 ? pending.periodStart : undefined,
    );

    return NextResponse.json({ success: true, period, weeks, pending, meta });
  } catch (error) {
    console.error('주문 집계 오류:', error);
    return NextResponse.json(
      { success: false, error: '주문 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
