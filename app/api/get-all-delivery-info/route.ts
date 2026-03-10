import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Next.js 캐시 비활성화
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 모든 배송정보 조회 API (초기 로딩용)
export const GET = async (_request: NextRequest) => {
  try {
    // Supabase에서 모든 배송정보 조회 (1000행 limit 우회 페이징)
    let allData: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
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
        allData = allData.concat(data);
        from += pageSize;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    console.log(`배송정보 조회 완료: ${allData.length}건`);

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
