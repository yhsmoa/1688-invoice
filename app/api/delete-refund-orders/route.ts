import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids 배열이 필요합니다.' }, { status: 400 });
    }

    // 여러 항목 삭제
    const { data, error } = await supabase
      .from('invoiceManager_refundOrder')
      .delete()
      .in('id', ids)
      .select();

    if (error) {
      return NextResponse.json({
        success: false,
        error: '삭제 실패',
        details: error.message
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '삭제 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
