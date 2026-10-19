import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { FT_ORDER_ITEMS_DISPLAY_SELECT } from '../../../../../lib/ftOrderItemsSelect';

// ============================================================
// POST /api/ft/order-items/by-product-ids  { product_ids: string[] }
//   → { success, data: FtOrderItem[] }  (item_no ASC)
//
// 상품입고 V3 — 세트 구성품(형제 행) 조회.
//   세트 1벌(product_id) 의 구성품이 다른 1688 주문으로 따로 오는 경우가 있다
//   (2026-10-18 기준 PROCESSING 세트 1,320 중 13). 배송번호 검색 결과에는 한쪽만
//   보이므로, 모달을 열 때 product_id 로 나머지 구성품을 가져와 세트 스티커 계산·
//   "이 배송에 없음" 표시에 쓴다.
//
// SELECT 는 화면용 공통 상수 — 화면 렌더 로직 일관성 보장.
// ft_order_items 는 3만 건을 넘는다 → product_id 100개 배치 + 1000행 페이지네이션.
// ============================================================

const ID_BATCH = 100;
const PAGE = 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const productIds: string[] = Array.isArray(body?.product_ids)
      ? Array.from(new Set((body.product_ids as unknown[]).filter((v): v is string => typeof v === 'string' && !!v)))
      : [];

    if (productIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const all: Record<string, unknown>[] = [];
    for (let i = 0; i < productIds.length; i += ID_BATCH) {
      const batch = productIds.slice(i, i + ID_BATCH);
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('ft_order_items')
          .select(FT_ORDER_ITEMS_DISPLAY_SELECT)
          .in('product_id', batch)
          .order('item_no', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // 배치 경계 너머 순서 보장 — item_no 기준 최종 정렬 (by-delivery-code 와 동일)
    all.sort((a, b) =>
      String(a.item_no ?? '').localeCompare(String(b.item_no ?? ''), undefined, { numeric: true, sensitivity: 'base' })
    );

    return NextResponse.json({ success: true, data: all });
  } catch (error) {
    console.error('product_id 로 주문 항목 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '세트 구성품 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
