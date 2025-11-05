import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// 모든 배송정보 조회 API (초기 로딩용)
export const GET = async (request: NextRequest) => {
  console.log('모든 배송정보 조회 API 호출');

  try {
    // Supabase에서 모든 배송정보 조회
    // range(0, 9999)는 10000개를 의미하지만 실제로는 페이지네이션 필요
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('*')
        .order('delivery_code', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('Supabase 조회 오류:', error);
        return NextResponse.json({
          success: false,
          error: '배송정보 조회 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }

      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += pageSize;
        hasMore = data.length === pageSize; // 1000개 미만이면 마지막 페이지
        console.log(`${from}개 조회 완료... (현재 배치: ${data.length}개)`);
      } else {
        hasMore = false;
      }
    }

    console.log(`총 ${allData.length}개의 배송정보를 조회했습니다.`);

    return NextResponse.json({
      success: true,
      message: `${allData.length}개의 배송정보를 조회했습니다.`,
      data: allData,
      count: allData.length
    });

  } catch (error) {
    console.error('배송정보 조회 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: '배송정보 조회 중 예외가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};