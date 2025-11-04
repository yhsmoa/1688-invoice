import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

/**
 * 주문 검사용 배송정보 전체 조회 API
 * 1688_invoice_deliveryInfo_check 테이블에서 모든 배송정보 가져오기
 */
export async function GET() {
  try {
    console.log('주문 검사 배송정보 전체 조회 시작...');

    // 먼저 전체 개수 확인
    const { count, error: countError } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('배송정보 개수 조회 오류:', countError);
      return NextResponse.json({
        success: false,
        error: '배송정보 개수 조회 중 오류가 발생했습니다.',
        details: countError.message
      }, { status: 500 });
    }

    console.log(`총 배송정보 개수: ${count}개`);

    // 페이지네이션으로 모든 데이터 가져오기
    const pageSize = 1000;
    const totalPages = Math.ceil((count || 0) / pageSize);
    let allData: any[] = [];

    for (let page = 0; page < totalPages; page++) {
      const start = page * pageSize;
      const end = start + pageSize - 1;

      console.log(`페이지 ${page + 1}/${totalPages} 조회 중... (${start}-${end})`);

      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('*')
        .range(start, end);

      if (error) {
        console.error(`페이지 ${page + 1} 조회 오류:`, error);
        continue; // 에러 발생해도 계속 진행
      }

      if (data) {
        allData = allData.concat(data);
      }
    }

    console.log(`배송정보 ${allData.length}개 조회 완료`);

    return NextResponse.json({
      success: true,
      data: allData,
      count: allData.length
    });

  } catch (error) {
    console.error('배송정보 조회 중 예외:', error);
    return NextResponse.json({
      success: false,
      error: '배송정보 조회 중 예외가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
