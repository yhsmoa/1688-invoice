import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, status } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids 배열이 필요합니다.' }, { status: 400 });
    }

    if (!status) {
      return NextResponse.json({ success: false, error: 'status가 필요합니다.' }, { status: 400 });
    }

    // 업데이트할 데이터 구성
    const updateData: {
      refund_status: string;
      updated_at: string;
      confirm_date?: string;
    } = {
      refund_status: status,
      updated_at: new Date().toISOString()
    };

    // '완료' 상태로 변경 시 confirm_date에 현재 시간 기록
    if (status === '완료') {
      updateData.confirm_date = new Date().toISOString();
    }

    // 여러 항목의 상태를 업데이트
    const { data, error } = await supabase
      .from('invoiceManager_refundOrder')
      .update(updateData)
      .in('id', ids)
      .select();

    if (error) {
      return NextResponse.json({
        success: false,
        error: '상태 업데이트 실패',
        details: error.message
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '상태 업데이트 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
