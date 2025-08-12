import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // users_api 테이블에서 coupang_name과 googlesheet_id 가져오기
    const { data, error } = await supabase
      .from('users_api')
      .select('coupang_name, googlesheet_id')
      .order('coupang_name');

    if (error) {
      console.error('사용자 목록 조회 오류:', error);
      return NextResponse.json({ 
        error: '사용자 목록을 불러오는데 실패했습니다.' 
      }, { status: 500 });
    }

    // null이나 빈 값 필터링
    const filteredData = (data || []).filter(user => user.coupang_name);

    return NextResponse.json({ 
      success: true,
      data: filteredData
    });
  } catch (error) {
    console.error('사용자 목록 조회 중 오류:', error);
    return NextResponse.json({ 
      error: '사용자 목록 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}