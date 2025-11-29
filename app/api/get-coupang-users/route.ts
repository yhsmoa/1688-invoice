import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/get-coupang-users 호출됨');

    // users_api 테이블에서 coupang_name, googlesheet_id, user_code, master_account, user_id 가져오기
    const { data, error } = await supabase
      .from('users_api')
      .select('coupang_name, googlesheet_id, user_code, master_account, user_id')
      .order('coupang_name');

    console.log('Supabase 쿼리 결과:', { data, error });

    if (error) {
      console.error('사용자 목록 조회 오류:', error);
      return NextResponse.json({
        success: false,
        error: '사용자 목록을 불러오는데 실패했습니다.',
        details: error
      }, { status: 500 });
    }

    // null이나 빈 값 필터링
    const filteredData = (data || []).filter(user => user.coupang_name);

    console.log(`필터링된 사용자 수: ${filteredData.length}`, filteredData);

    return NextResponse.json({
      success: true,
      data: filteredData
    });
  } catch (error) {
    console.error('사용자 목록 조회 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '사용자 목록 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}