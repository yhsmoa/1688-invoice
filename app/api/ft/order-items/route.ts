import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { pickDisplayColumns } from '../../../../lib/ftOrderItemsSelect';
import { jsonResponse } from '../../../../lib/apiResponse';

// ============================================================
// GET /api/ft/order-items?user_id=X&status=PROCESSING
// ft_order_items 사용자·상태별 전체 조회 — RPC ft_order_items_by_user 1회 (supabase/perf/001)
//   · 1000행 페이지 루프를 없앴다 (사용자당 1,600행 → 2회 왕복이던 것이 1회, 행이 늘어도 1회)
//   · 컬럼은 by-delivery-code 와 같은 FT_ORDER_ITEMS_DISPLAY_COLUMNS (pickDisplayColumns)
//   · 응답 2MB 안팎 → gzip (jsonResponse)
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

    // status=ALL 이면 함수 안에서 상태 필터 없음, 그 외는 해당 status
    const { data, error } = await supabase.rpc('ft_order_items_by_user', {
      p_user_id: userId,
      p_status: status,
    });
    if (error) throw error;

    return jsonResponse(request, {
      success: true,
      data: pickDisplayColumns((data ?? []) as Record<string, unknown>[]),
    });
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
//
// arrival_route(보관) 는 받지 않는다 — 상품(세트) 단위로 바꿔야 하므로
//   PATCH /api/ft/order-items/arrival-route 를 쓴다.
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    // ── arrival_route 차단 (전용 API 로) ──
    const allFields: unknown[] = Array.isArray(body.updates)
      ? body.updates.map((u: { fields?: unknown }) => u?.fields)
      : [body.fields];
    if (allFields.some((f) => f && typeof f === 'object' && 'arrival_route' in (f as object))) {
      return NextResponse.json(
        { success: false, error: 'arrival_route 는 /api/ft/order-items/arrival-route 로 변경하세요.' },
        { status: 400 }
      );
    }

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
