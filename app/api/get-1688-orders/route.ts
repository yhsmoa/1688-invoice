import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Next.js 캐시 비활성화
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * invoiceManager_1688_orders 테이블 전체 조회 API
 * 배송번호 → order_id → 1688_order_id → order_number 매칭에 사용
 */
export const GET = async (request: NextRequest) => {
  console.log('invoiceManager_1688_orders 조회 API 호출');

  try {
    // 먼저 전체 데이터 개수 확인
    const { count: totalCount, error: countError } = await supabase
      .from('invoiceManager_1688_orders')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('전체 개수 조회 오류:', countError);
      return NextResponse.json({
        success: false,
        error: '데이터 개수 조회 중 오류가 발생했습니다.',
        details: countError.message
      }, { status: 500 });
    }

    console.log(`📊 invoiceManager_1688_orders 총 데이터 개수: ${totalCount}개`);

    // 페이지네이션으로 모든 데이터 가져오기 (limit 제한 없음)
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    let loopCount = 0;

    while (hasMore) {
      loopCount++;
      console.log(`🔄 [루프 ${loopCount}] range(${from}, ${from + pageSize - 1})`);

      const { data, error } = await supabase
        .from('invoiceManager_1688_orders')
        .select('id, order_number, "1688_order_id", barcode, item_name, option_name, china_option1, china_option2, order_qty, status_import, status_cancel, img_url, site_url, coupang_shipment_size, composition, recomanded_age')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('Supabase 조회 오류:', error);
        return NextResponse.json({
          success: false,
          error: '데이터 조회 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }

      if (data && data.length > 0) {
        console.log(`   ✅ 반환된 데이터: ${data.length}개`);
        allData = allData.concat(data);
        from += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`========================================`);
    console.log(`✅ invoiceManager_1688_orders 조회 완료`);
    console.log(`📦 총 수집 데이터: ${allData.length}개`);
    console.log(`========================================`);

    return NextResponse.json({
      success: true,
      message: `${allData.length}개의 주문 데이터를 조회했습니다.`,
      data: allData,
      count: allData.length
    });

  } catch (error) {
    console.error('invoiceManager_1688_orders 조회 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: '데이터 조회 중 예외가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
