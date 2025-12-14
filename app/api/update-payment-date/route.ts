import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, date } = body;

    // 필수값 검증
    if (!id) {
      return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 });
    }

    // 날짜 형식 검증 (YYYY-MM-DD)
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ success: false, error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' }, { status: 400 });
    }

    // 트랜잭션 날짜 업데이트
    const { data, error } = await supabase
      .from('invoiceManager_transactions')
      .update({ date })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({
        success: false,
        error: `날짜 수정 실패: ${error.message}`,
        details: error
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('날짜 수정 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '날짜 수정 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
