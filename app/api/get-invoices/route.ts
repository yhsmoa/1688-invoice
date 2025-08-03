import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// Next.js 14 API 라우트 형식으로 수정
export const GET = async () => {
  try {
    console.log('GET /api/get-invoices 호출됨');
    
    // Supabase에서 모든 컬럼 선택 (필드 명시 없이)
    const { data: invoices, error } = await supabase
      .from('1688_invoice')
      .select('*')
      .order('order_date', { ascending: false });

    if (error) {
      console.error('Supabase 조회 오류:', error);
      return NextResponse.json({ 
        error: '데이터를 가져오는 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    console.log('조회된 데이터 수:', invoices?.length);

    // 캐시 방지 헤더 추가
    const response = NextResponse.json(invoices || []);
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('데이터 가져오기 상세 오류:', error);
    return NextResponse.json({ 
      error: '데이터를 가져오는 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 