import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { confirmDoneForUser } from '../../../../lib/confirmDone';

// ============================================================
// GET /api/debug/confirm-done?user_id=xxx
//   confirmDoneForUser 실행 + 상세 집계 결과 조회 (디버그 전용)
//
// 주의: 인증 없이 호출되면 PROCESSING → DONE 상태 변경이 발생하므로
//       NODE_ENV='production' 에서는 비활성화.
// ============================================================
export async function GET(request: NextRequest) {
  // ── 프로덕션 환경에서는 비활성화 (부작용 방지) ──
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'debug endpoint is disabled in production' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ success: false, error: 'user_id 필요' }, { status: 400 });
    }

    // 1) PROCESSING items 조회
    const { data: items } = await supabase
      .from('ft_order_items')
      .select('id, order_qty, product_id')
      .eq('user_id', userId)
      .eq('status', 'PROCESSING');

    if (!items || items.length === 0) {
      return NextResponse.json({
        success: true,
        userId,
        processingItems: [],
        message: 'PROCESSING items 없음'
      });
    }

    // 2) product_ids 추출
    const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];

    // 3) CANCEL 집계
    const { data: cancelData } = await supabase
      .from('ft_fulfillment_inbounds')
      .select('order_item_id, quantity')
      .in('order_item_id', items.map(i => i.id))
      .eq('type', 'CANCEL');

    const cancelMap = new Map();
    cancelData?.forEach(row => {
      cancelMap.set(row.order_item_id, (cancelMap.get(row.order_item_id) ?? 0) + row.quantity);
    });

    // 4) PACKED 집계 (product_id 기준)
    const { data: packedData } = await supabase
      .from('ft_fulfillment_outbounds')
      .select('product_id, quantity')
      .in('product_id', productIds)
      .eq('type', 'PACKED');

    const shippedByProductMap = new Map();
    packedData?.forEach(row => {
      shippedByProductMap.set(row.product_id, (shippedByProductMap.get(row.product_id) ?? 0) + row.quantity);
    });

    // 5) 상세 계산 결과
    const details = items.map(item => {
      const orderQty = item.order_qty ?? 0;
      const cancelQty = cancelMap.get(item.id) ?? 0;
      const shippedQty = shippedByProductMap.get(item.product_id) ?? 0;
      const remaining = orderQty - cancelQty - shippedQty;

      return {
        id: item.id.substring(0, 8) + '...',
        product_id: item.product_id?.substring(0, 8) + '...',
        order_qty: orderQty,
        cancel_qty: cancelQty,
        shipped_qty: shippedQty,
        remaining,
        should_done: remaining <= 0
      };
    });

    // 6) confirmDoneForUser 실행
    const result = await confirmDoneForUser(userId);

    return NextResponse.json({
      success: true,
      userId,
      processingCount: items.length,
      productIdCount: productIds.length,
      details,
      confirmResult: result,
      summary: `PROCESSING ${items.length}개 중 ${result.updated}개 DONE 처리`
    });

  } catch (error) {
    console.error('debug error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
