import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// 매 요청 조회 — 고객이 장바구니를 주문으로 넘기면 바로 반영돼야 한다
export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/new-orders
//   신규주문 상황 — auto-1688-order 프로그램 [V2 주문] 탭 상단 "신규주문건" 보드와 같은 집계
//
//   대상: ft_carts.status = 'ORDER' (고객이 주문으로 넘긴 뒤 아직 프로그램에서 불러오지 않은 카트)
//   사용자별: 카트 수 · 품목 수(ft_cart_items 행 수) · 총 개수(order_qty 합)
//   이름: ft_users.vender_name || full_name
//
//   건수 (2026-11-02): ft_carts 638 (ORDER 4) / ft_cart_items 31,071
//   → 카트·품목 모두 id 정렬 range 루프로 1000행 제한을 넘겨도 끝까지 읽는다.
// ============================================================

const PAGE = 1000;
const ID_CHUNK = 100;

interface CartRow { id: string; user_id: string; cart_name: string | null; created_at: string }
interface CartItemRow { id: string; cart_id: string; order_qty: number | string | null }
interface UserRow { id: string; vender_name: string | null; full_name: string | null }

export interface NewOrderCart {
  id: string;
  cart_name: string | null;
  created_at: string;
  items: number;
  qty: number;
}

export interface NewOrderUserSummary {
  user_id: string;
  name: string;
  carts: number;
  items: number;
  qty: number;
  cartList: NewOrderCart[];
}

// ── ORDER 카트 전체 (id 정렬 range 루프) ──
async function fetchOrderCarts(): Promise<CartRow[]> {
  const all: CartRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ft_carts')
      .select('id, user_id, cart_name, created_at')
      .eq('status', 'ORDER')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as CartRow[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// ── 카트별 품목 (카트 id 100개 단위 × id 정렬 range 루프) ──
async function fetchCartItems(cartIds: string[]): Promise<CartItemRow[]> {
  const all: CartItemRow[] = [];
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
      all.push(...((data ?? []) as CartItemRow[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return all;
}

export async function GET() {
  try {
    const carts = await fetchOrderCarts();
    if (carts.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // ============================================================
    // 집계
    // ============================================================
    const [items, usersRes] = await Promise.all([
      fetchCartItems(carts.map((c) => c.id)),
      supabase
        .from('ft_users')
        .select('id, vender_name, full_name')
        .in('id', Array.from(new Set(carts.map((c) => c.user_id)))),
    ]);
    if (usersRes.error) throw usersRes.error;

    // ── 카트별 품목 수 · 총 개수 ──
    const cartTotals = new Map<string, { items: number; qty: number }>();
    for (const it of items) {
      const t = cartTotals.get(it.cart_id) ?? { items: 0, qty: 0 };
      t.items += 1;
      t.qty += parseInt(String(it.order_qty ?? 0), 10) || 0;
      cartTotals.set(it.cart_id, t);
    }

    // ── 사용자 이름 ──
    const nameById = new Map<string, string>();
    for (const u of (usersRes.data ?? []) as UserRow[]) {
      nameById.set(u.id, u.vender_name || u.full_name || u.id);
    }

    // ── 사용자별 묶기 ──
    const byUser = new Map<string, NewOrderUserSummary>();
    for (const cart of carts) {
      const t = cartTotals.get(cart.id) ?? { items: 0, qty: 0 };
      const s = byUser.get(cart.user_id) ?? {
        user_id: cart.user_id,
        name: nameById.get(cart.user_id) ?? cart.user_id,
        carts: 0,
        items: 0,
        qty: 0,
        cartList: [],
      };
      s.carts += 1;
      s.items += t.items;
      s.qty += t.qty;
      s.cartList.push({ id: cart.id, cart_name: cart.cart_name, created_at: cart.created_at, items: t.items, qty: t.qty });
      byUser.set(cart.user_id, s);
    }

    // 정렬: 사용자 이름순 (프로그램 보드와 동일) / 카트는 오래된 순
    const data = Array.from(byUser.values())
      .map((s) => ({ ...s, cartList: s.cartList.sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('신규주문 상황 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '신규주문 상황을 불러오는 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
