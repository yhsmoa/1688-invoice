import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json({ success: false, error: 'user_id가 필요합니다.' }, { status: 400 });
    }

    // 배치 처리로 모든 데이터 가져오기
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('invoiceManager_refundOrder')
        .select('id, order_number, product_name, option_name_cn, qty, refund_amount, refund_type, refund_description, refund_status, "1688_order_number", site_url, img_url, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, from + batchSize - 1);

      if (error) {
        return NextResponse.json({
          success: false,
          error: '환불 주문 조회 실패',
          details: error.message
        }, { status: 500 });
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += batchSize;

        // 데이터가 batchSize보다 적으면 마지막 배치
        if (data.length < batchSize) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    return NextResponse.json({ success: true, data: allData });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '환불 주문 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
