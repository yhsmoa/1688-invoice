import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/ft/order-items?user_id=X&status=PROCESSING
// ft_order_items 테이블에서 주문 아이템 조회
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

    const { data, error } = await supabase
      .from('ft_order_items')
      .select(
        'id, order_no, item_no, item_name, option_name, order_qty, barcode, china_option1, china_option2, price_cny, price_total_cny, img_url, coupang_shipment_size, status, composition, recommanded_age'
      )
      .eq('user_id', userId)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
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
