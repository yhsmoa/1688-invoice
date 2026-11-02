import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import {
  parsePeriod,
  periodEndOf,
  periodStartOf,
  toKstDate,
  type Period,
} from '../../../../lib/periodBucket';
import { guardDbRoute } from '../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/db/order-weekly?period=week|month
//
// 주간(월~일) / 월간 단위 주문 집계
//   · 구간 기준일 : ft_orders.created_at (KST 변환)
//   · 주문 수량   : ft_order_items.order_qty 합
//       ※ ft_orders.total_qty 는 품목 합계와 불일치하는 주문이 있어
//         (219건 중 22건) 신뢰하지 않고 품목 기준으로 집계한다.
//         불일치 건수는 meta.headerQtyMismatch 로 함께 반환.
//   · 배송유형    : ft_order_items.shipment_type (COUPANG / PERSONAL / DIRECT)
//   · 진행상태    : ft_order_items.status (DONE / 그 외 = 진행중)
//
// 잠재 주문량 (pending) — 아직 ft_orders 로 넘어오지 않은 고객 카트
//   · 주문요청 : ft_carts.status = 'ORDER' (고객이 [주문] 했고 프로그램이 아직 안 불러옴)
//   · 카트     : ft_carts.status = 'NEW'   (고객 장바구니, 편집 중)
//   · 'DONE' 카트는 이미 ft_orders 로 전환됐으므로 제외 (이중 집계 방지)
//   · 불러오면 그 시점이 ft_orders.created_at 이 되므로 "오늘이 속한 구간"에 얹는다.
//
// ⚠️ ft_order_items 1.7만 행 → range() 페이지네이션 필수
//    ft_carts 643 / ft_cart_items 3.1만 (2026-11-02, NEW 3 · ORDER 9 카트)
//    → 카트·품목 모두 range 루프 + 카트 id 100개 단위 in() 조회
// ============================================================

const PAGE = 1000;
const ID_CHUNK = 100;
const PENDING_CART_STATUSES = ['ORDER', 'NEW'] as const;
type PendingCartStatus = (typeof PENDING_CART_STATUSES)[number];

// ── 전체 조회 helper (1000행 limit 우회) ──
async function fetchAll<T>(table: string, select: string, orderColumn: string): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

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
interface PendingStat {
  carts: number;
  items: number;
  qty: number;
}

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

// ── 구간(주/월) 누적 버킷 ──
interface PeriodBucket {
  periodStart: string;
  orderIds: Set<string>;
  userIds: Set<string>;
  itemRows: number;
  qty: number;
  coupangQty: number;
  personalQty: number;
  directQty: number;
  doneQty: number;
  amountCny: number;
}

function bucketOf(map: Map<string, PeriodBucket>, periodStart: string): PeriodBucket {
  let b = map.get(periodStart);
  if (!b) {
    b = {
      periodStart,
      orderIds: new Set(),
      userIds: new Set(),
      itemRows: 0,
      qty: 0,
      coupangQty: 0,
      personalQty: 0,
      directQty: 0,
      doneQty: 0,
      amountCny: 0,
    };
    map.set(periodStart, b);
  }
  return b;
}

export async function GET(request: NextRequest) {
  try {
    // ── 접근 권한 검증 (DB 관리 메뉴 전용) ──
    const denied = await guardDbRoute(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const period: Period = parsePeriod(searchParams.get('period'));

    type OrderRow = {
      id: string;
      created_at: string | null;
      user_id: string | null;
      total_qty: number | null;
    };
    type ItemRow = {
      id: string;
      order_id: string | null;
      order_qty: number | null;
      shipment_type: string | null;
      status: string | null;
      price_total_cny: number | null;
    };

    // ── 1. 원본 조회 ──
    const [orders, items, pending] = await Promise.all([
      fetchAll<OrderRow>('ft_orders', 'id, created_at, user_id, total_qty', 'id'),
      fetchAll<ItemRow>(
        'ft_order_items',
        'id, order_id, order_qty, shipment_type, status, price_total_cny',
        'id'
      ),
      loadPending(),
    ]);

    const orderById = new Map<string, OrderRow>();
    orders.forEach((o) => orderById.set(o.id, o));

    // ── 2. 구간(주/월) 집계 (기준 = 주문 생성일) ──
    const buckets = new Map<string, PeriodBucket>();
    let orphanItems = 0;

    items.forEach((it) => {
      const order = it.order_id ? orderById.get(it.order_id) : undefined;
      if (!order || !order.created_at) {
        orphanItems += 1;
        return;
      }

      const b = bucketOf(buckets, periodStartOf(toKstDate(order.created_at), period));
      const qty = it.order_qty ?? 0;

      b.orderIds.add(order.id);
      if (order.user_id) b.userIds.add(order.user_id);
      b.itemRows += 1;
      b.qty += qty;
      b.amountCny += Number(it.price_total_cny ?? 0);

      if (it.shipment_type === 'COUPANG') b.coupangQty += qty;
      else if (it.shipment_type === 'PERSONAL') b.personalQty += qty;
      else if (it.shipment_type === 'DIRECT') b.directQty += qty;

      if (it.status === 'DONE') b.doneQty += qty;
    });

    // 품목이 하나도 없는 주문도 주차에 포함 (주문 건수 정확도)
    orders.forEach((o) => {
      if (!o.created_at) return;
      const b = bucketOf(buckets, periodStartOf(toKstDate(o.created_at), period));
      b.orderIds.add(o.id);
      if (o.user_id) b.userIds.add(o.user_id);
    });

    // 잠재 주문량이 얹힐 "오늘이 속한 구간" — 아직 주문이 없는 구간이어도 행을 만든다
    const pendingPeriodStart = periodStartOf(toKstDate(new Date().toISOString()), period);
    if (pending.request.qty + pending.cart.qty > 0) bucketOf(buckets, pendingPeriodStart);

    // ── 3. 헤더 수량(ft_orders.total_qty) 불일치 검증 ──
    const itemQtyByOrder = new Map<string, number>();
    items.forEach((it) => {
      if (!it.order_id) return;
      itemQtyByOrder.set(it.order_id, (itemQtyByOrder.get(it.order_id) ?? 0) + (it.order_qty ?? 0));
    });
    const headerQtyMismatch = orders.filter(
      (o) => (o.total_qty ?? 0) !== (itemQtyByOrder.get(o.id) ?? 0)
    ).length;

    // ── 4. 응답 변환 (최신 구간 먼저) ──
    const weeks = Array.from(buckets.values())
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))
      .map((b) => ({
        weekStart: b.periodStart,
        weekEnd: periodEndOf(b.periodStart, period),
        orderCount: b.orderIds.size,
        userCount: b.userIds.size,
        itemRows: b.itemRows,
        qty: b.qty,
        coupangQty: b.coupangQty,
        personalQty: b.personalQty,
        directQty: b.directQty,
        doneQty: b.doneQty,
        amountCny: Math.round(b.amountCny),
      }));

    return NextResponse.json({
      success: true,
      period,
      weeks,
      pending: {
        periodStart: pendingPeriodStart,
        request: pending.request,
        cart: pending.cart,
      },
      meta: {
        weekCount: weeks.length,
        orderRows: orders.length,
        itemRows: items.length,
        orphanItems,
        headerQtyMismatch,
      },
    });
  } catch (error) {
    console.error('주간 주문 집계 오류:', error);
    return NextResponse.json(
      { success: false, error: '주간 주문 집계 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
