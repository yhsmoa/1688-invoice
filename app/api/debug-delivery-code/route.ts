import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// 특정 배송번호 디버깅 API
export const GET = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const deliveryCode = searchParams.get('code') || '434984890541517';

  console.log(`\n🔍 배송번호 디버깅: ${deliveryCode}`);

  try {
    // 1. 전체 데이터 개수 확인
    const { count: totalCount } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*', { count: 'exact', head: true });

    console.log(`📊 전체 데이터 개수: ${totalCount}`);

    // 2. 해당 배송번호 검색
    const { data: matchedData, error } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*')
      .eq('delivery_code', deliveryCode);

    if (error) {
      console.error('검색 오류:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    console.log(`✅ 매칭된 데이터: ${matchedData?.length || 0}개`);

    if (matchedData && matchedData.length > 0) {
      const row = matchedData[0];
      console.log(`📍 데이터 상세:`, row);

      // 3. 이 행이 몇 번째 위치인지 확인 (id 기준)
      const { count: positionCount } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('*', { count: 'exact', head: true })
        .lt('id', row.id);

      console.log(`📌 위치: ${positionCount}번째 행 (0-based index)`);
      console.log(`🔢 range 계산: ${Math.floor(positionCount / 1000)} 번째 페이지 (0부터 시작)`);

      return NextResponse.json({
        success: true,
        found: true,
        totalCount,
        matchedCount: matchedData.length,
        data: row,
        position: positionCount,
        pageNumber: Math.floor(positionCount / 1000),
        rangeStart: Math.floor(positionCount / 1000) * 1000,
        rangeEnd: Math.floor(positionCount / 1000) * 1000 + 999
      });
    } else {
      console.log(`❌ 데이터를 찾을 수 없음`);
      return NextResponse.json({
        success: true,
        found: false,
        totalCount,
        message: '해당 배송번호가 존재하지 않습니다.'
      });
    }
  } catch (error) {
    console.error('디버깅 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
