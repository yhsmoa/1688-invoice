import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/ft/delivery-codes?order_id=XXX
// 1688_order_id → 1688_invoice_deliveryInfo_check 역조회
// → unique delivery_code[] 반환
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('order_id');

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'order_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('delivery_code')
      .eq('order_id', orderId);

    if (error) throw error;

    // unique delivery_code 추출 (null/빈 값 제외)
    const uniqueCodes = [
      ...new Set(
        (data || [])
          .map((r: { delivery_code: string | null }) => r.delivery_code)
          .filter(Boolean)
      ),
    ];

    return NextResponse.json({ success: true, data: uniqueCodes });
  } catch (error) {
    console.error('delivery-codes GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'delivery_code 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
