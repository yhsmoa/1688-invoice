import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/hr/verify-access
// 8자리 코드로 접근 권한 검증
// code 컬럼 검색 + access_authorization=true 확인
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return NextResponse.json(
        { success: false, error: '코드를 입력해주세요.' },
        { status: 400 }
      );
    }

    // code 컬럼에서 검색
    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .select('id, access_authorization')
      .eq('code', code.trim())
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: '코드가 일치하는 직원이 없습니다.' },
        { status: 401 }
      );
    }

    // access_authorization 확인
    if (!data.access_authorization) {
      return NextResponse.json(
        { success: false, error: '접근 권한이 없습니다.' },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('접근 코드 검증 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '검증 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}
