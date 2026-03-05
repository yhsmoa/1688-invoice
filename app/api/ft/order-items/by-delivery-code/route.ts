import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// GET /api/ft/order-items/by-delivery-code?delivery_code=XXX
//
// 배송번호 2-hop 조회:
//   Step 1) 1688_invoice_deliveryInfo_check
//           WHERE delivery_code = input → order_id[]
//   Step 2) ft_order_items
//           WHERE 1688_order_id IN (order_ids) → FtOrderItem[]
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deliveryCode = searchParams.get('delivery_code')?.trim();

    if (!deliveryCode) {
      return NextResponse.json(
        { success: false, error: 'delivery_code 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── Step 1: deliveryInfo에서 order_id 목록 수집 ────────────
    const { data: deliveryRows, error: deliveryError } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('order_id')
      .eq('delivery_code', deliveryCode);

    if (deliveryError) throw deliveryError;

    // 중복 제거 + null 제외
    const orderIds = [
      ...new Set(
        (deliveryRows || [])
          .map((r) => r.order_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    if (orderIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // ── Step 2: ft_order_items에서 1688_order_id 기준 조회 ─────
    const { data, error } = await supabase
      .from('ft_order_items')
      .select(
        'id, order_no, item_no, item_name, option_name, order_qty, barcode,' +
        ' china_option1, china_option2, price_cny, price_total_cny,' +
        ' img_url, coupang_shipment_size, status, composition, recommanded_age,' +
        ' set_total, set_seq, product_no, site_url, 1688_order_id'
      )
      .in('1688_order_id', orderIds)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });

  } catch (error) {
    console.error('배송번호 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '배송번호로 아이템 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
