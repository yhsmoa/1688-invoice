import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/ft/fulfillments?order_item_ids=id1,id2,...
//
// ARRIVAL / CANCEL / SHIPMENT 3가지 타입을 한 번에 조회
// → 클라이언트에서 type별, order_item_id별 quantity 합산
// ============================================================
const FULFILLMENT_TYPES = ['ARRIVAL', 'PACKED', 'CANCEL', 'SHIPMENT'] as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('order_item_ids') ?? '';
    const orderItemIds = raw.split(',').map((s) => s.trim()).filter(Boolean);

    if (orderItemIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('ft_fulfillments')
      .select('order_item_id, quantity, type')
      .in('order_item_id', orderItemIds)
      .in('type', FULFILLMENT_TYPES);

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('ft_fulfillments 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/ft/fulfillments
// [1] { order_item_ids: string[] }  → 집계 조회 (GET 대체, URI 길이 제한 회피)
// [2] { items: FulfillmentItem[] }  → 입고 데이터 일괄 저장
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items, order_item_ids } = body;

    // ── [1] 조회 모드 ──────────────────────────────────────────
    if (order_item_ids && Array.isArray(order_item_ids)) {
      if (order_item_ids.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }

      const { data, error } = await supabase
        .from('ft_fulfillments')
        .select('order_item_id, quantity, type')
        .in('order_item_id', order_item_ids)
        .in('type', FULFILLMENT_TYPES);

      if (error) throw error;

      return NextResponse.json({ success: true, data: data || [] });
    }

    // ── [2] 저장 모드 ──────────────────────────────────────────
    // ============================================================
    // 1. 입력 데이터 검증
    // ============================================================
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. order_no 정규화: BZ-260224-0202-A01 → BZ-260224-0202
    //    앞 3개 파트(dash 기준)만 유지
    // ============================================================
    const normalizeOrderNo = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const parts = value.split('-');
      return parts.length > 3 ? parts.slice(0, 3).join('-') : value;
    };

    const normalizedItems = items.map((item: Record<string, unknown>) => ({
      ...item,
      order_no: normalizeOrderNo(item.order_no as string | null),
    }));

    // ============================================================
    // 3. Supabase INSERT (일괄)
    // ============================================================
    const { data, error } = await supabase
      .from('ft_fulfillments')
      .insert(normalizedItems)
      .select('id');

    if (error) throw error;

    console.log(`ft_fulfillments 저장 완료: ${data?.length ?? 0}개`);

    return NextResponse.json({
      success: true,
      count: data?.length ?? 0,
      message: `${data?.length ?? 0}개 데이터가 저장되었습니다.`,
    });
  } catch (error) {
    console.error('ft_fulfillments 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
