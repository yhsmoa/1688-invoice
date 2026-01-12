import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Next.js 캐시 비활성화
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 모든 배송정보 조회 API (초기 로딩용)
export const GET = async (request: NextRequest) => {
  console.log('모든 배송정보 조회 API 호출');
  console.log('🔧 Supabase URL:', supabaseUrl);
  console.log('🔑 Service Role Key (처음 20자):', supabaseKey?.substring(0, 20) + '...');

  try {
    // 먼저 전체 데이터 개수 확인
    const { count: totalCount, error: countError } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('전체 개수 조회 오류:', countError);
    } else {
      console.log(`📊 Supabase 총 데이터 개수: ${totalCount}개`);
    }

    // Supabase에서 모든 배송정보 조회
    // range(0, 9999)는 10000개를 의미하지만 실제로는 페이지네이션 필요
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    let loopCount = 0;

    while (hasMore) {
      loopCount++;
      console.log(`\n🔄 [루프 ${loopCount}] from=${from}, range(${from}, ${from + pageSize - 1})`);

      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('*')
        .order('id', { ascending: true })
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
        console.log(`   ✅ 반환된 데이터: ${data.length}개`);
        console.log(`   📍 첫 행 id: ${data[0]?.id}, 마지막 행 id: ${data[data.length - 1]?.id}`);

        allData = allData.concat(data);
        from += pageSize;
        hasMore = data.length === pageSize; // 1000개 미만이면 마지막 페이지

        console.log(`   📦 누적 데이터: ${allData.length}개`);
        console.log(`   🔁 hasMore: ${hasMore} (data.length=${data.length}, pageSize=${pageSize})`);
      } else {
        console.log(`   ❌ 빈 데이터 반환`);
        hasMore = false;
      }
    }

    console.log(`\n========================================`);
    console.log(`✅ 페이징 완료: 총 ${loopCount}개 루프 실행`);
    console.log(`📦 수집된 데이터: ${allData.length}개`);
    console.log(`📊 Supabase 실제: ${totalCount}개`);
    console.log(`❌ 누락된 데이터: ${totalCount ? totalCount - allData.length : '알 수 없음'}개`);
    console.log(`========================================\n`);

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
