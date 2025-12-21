import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, refund_amount, refund_description, delivery_fee, service_fee, confirm_date } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 });
    }

    // 업데이트할 필드 구성
    const updateData: any = { updated_at: new Date().toISOString() };

    if (refund_amount !== undefined) {
      updateData.refund_amount = refund_amount;
    }

    if (refund_description !== undefined) {
      updateData.refund_description = refund_description;
    }

    if (delivery_fee !== undefined) {
      updateData.delivery_fee = delivery_fee;
    }

    if (service_fee !== undefined) {
      updateData.service_fee = service_fee;
    }

    if (confirm_date !== undefined) {
      updateData.confirm_date = confirm_date;
    }

    const { data, error } = await supabase
      .from('invoiceManager_refundOrder')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) {
      return NextResponse.json({
        success: false,
        error: '반품 정보 업데이트 실패',
        details: error.message
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '반품 정보 업데이트 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
