import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// 공통 상수
// ============================================================
const FULFILLMENT_TYPES = ['ARRIVAL', 'PACKED', 'CANCEL', 'SHIPMENT'];

// ============================================================
// DELETE /api/ft/fulfillments?id=xxx
// ft_fulfillments 단건 삭제
// ============================================================
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('ft_fulfillments')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('ft_fulfillments DELETE 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 삭제 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/ft/fulfillments?order_item_ids=id1,id2,...
// (소량 조회 시 사용 가능, 다량은 POST 사용 권장)
// ============================================================
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
    console.error('ft_fulfillments GET 조회 오류:', error);
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
    //    Supabase .in()도 내부적으로 URL 쿼리 파라미터 → ID 수가 많으면 실패
    //    100개 단위로 배치 조회 후 합산
    // ──────────────────────────────────────────────────────────────
    if (order_item_ids && Array.isArray(order_item_ids)) {
      try {
        if (order_item_ids.length === 0) {
          return NextResponse.json({ success: true, data: [] });
        }

        const BATCH_SIZE = 100;
        const allData: { id: string; order_item_id: string; quantity: number; type: string; created_at: string; operator_name: string | null }[] = [];

        for (let i = 0; i < order_item_ids.length; i += BATCH_SIZE) {
          const batch = order_item_ids.slice(i, i + BATCH_SIZE);

          const { data, error } = await supabase
            .from('ft_fulfillments')
            .select('id, order_item_id, quantity, type, created_at, operator_name')
            .in('order_item_id', batch)
            .in('type', FULFILLMENT_TYPES);

          if (error) throw error;
          if (data) allData.push(...data);
        }

        return NextResponse.json({ success: true, data: allData });
      } catch (queryError) {
        console.error('ft_fulfillments POST 조회 오류:', queryError);
        return NextResponse.json(
          {
            success: false,
            error: 'ft_fulfillments 조회 중 오류가 발생했습니다.',
            details: (queryError as Record<string, unknown>)?.message ?? JSON.stringify(queryError),
          },
          { status: 500 }
        );
      }
    }

    // ── [2] 저장 모드 ──────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // order_no 정규화: BZ-260224-0202-A01 → BZ-260224-0202
    const normalizeOrderNo = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const parts = value.split('-');
      return parts.length > 3 ? parts.slice(0, 3).join('-') : value;
    };

    const normalizedItems = items.map((item: Record<string, unknown>) => ({
      ...item,
      order_no: normalizeOrderNo(item.order_no as string | null),
    }));

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
