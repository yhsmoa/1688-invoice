import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

const ORDER_ITEMS_SELECT = 'id, order_no, item_no, item_name, option_name, order_qty, barcode, china_option1, china_option2, price_cny, price_total_cny, img_url, coupang_shipment_size, status, composition, recommanded_age, set_total, set_seq, product_no, product_id, site_url, 1688_order_id, shipment_type, customs_category';

// ============================================================
// GET /api/ft/order-items?user_id=X&status=PROCESSING
// ft_order_items 테이블에서 주문 아이템 조회 (limit 해제)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const status = searchParams.get('status') || 'PROCESSING';

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // 1000행 limit 우회 — 페이징 조회
    const PAGE = 1000;
    const all: Record<string, unknown>[] = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from('ft_order_items')
        .select(ORDER_ITEMS_SELECT)
        .eq('user_id', userId);

      // status=ALL이면 필터 없이 전체 조회, 그 외는 해당 status 필터
      if (status !== 'ALL') {
        query = query.eq('status', status);
      }

      const { data, error } = await query
        .order('item_no', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    return NextResponse.json({ success: true, data: all });
  } catch (error) {
    console.error('ft_order_items 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '주문 아이템을 불러오는 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/ft/order-items
// ft_order_items 단건/다건 필드 업데이트
// Body: { id: string, fields: Record<string, unknown> }
//    or { updates: { id: string, fields: Record<string, unknown> }[] }
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    // 다건 업데이트
    if (body.updates && Array.isArray(body.updates)) {
      let count = 0;
      for (const u of body.updates) {
        const { error } = await supabase
          .from('ft_order_items')
          .update(u.fields)
          .eq('id', u.id);
        if (error) throw error;
        count++;
      }
      return NextResponse.json({ success: true, count });
    }

    // 단건 업데이트
    const { id, fields } = body;
    if (!id || !fields) {
      return NextResponse.json(
        { success: false, error: 'id와 fields가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('ft_order_items')
      .update(fields)
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('ft_order_items PATCH 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_order_items 업데이트 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
