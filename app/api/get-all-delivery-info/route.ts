import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// 모든 배송정보 조회 API (초기 로딩용)
export const GET = async (request: NextRequest) => {
  console.log('모든 배송정보 조회 API 호출');

  try {
    // 먼저 총 개수 확인
    const { count: totalCount, error: countError } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('Supabase 개수 조회 오류:', countError);
    } else {
      console.log(`Supabase 총 레코드 수: ${totalCount}`);
    }

    // Supabase에서 모든 배송정보 조회
    // id 기준으로 정렬하여 NULL 값 문제 방지
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    let retryCount = 0;
    const maxRetries = 3;

    while (hasMore) {
      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error(`Supabase 조회 오류 (from: ${from}):`, error);

        // 재시도 로직
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`재시도 ${retryCount}/${maxRetries}...`);
          continue;
        }

        return NextResponse.json({
          success: false,
          error: '배송정보 조회 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }

      retryCount = 0; // 성공시 재시도 카운트 리셋

      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += pageSize;
        hasMore = data.length === pageSize; // 1000개 미만이면 마지막 페이지
        console.log(`${allData.length}개 조회 완료... (현재 배치: ${data.length}개)`);
      } else {
        hasMore = false;
      }
    }

    console.log(`총 ${allData.length}개의 배송정보를 조회했습니다.`);

    // 개수 불일치 경고
    if (totalCount && allData.length !== totalCount) {
      console.warn(`⚠️ 개수 불일치! Supabase: ${totalCount}, 로드됨: ${allData.length}, 차이: ${totalCount - allData.length}`);
    }

    return NextResponse.json({
      success: true,
      message: `${allData.length}개의 배송정보를 조회했습니다.`,
      data: allData,
      count: allData.length,
      totalInDb: totalCount || allData.length
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