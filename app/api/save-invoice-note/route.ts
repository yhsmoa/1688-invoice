import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderNumber, note } = body;

    if (!orderNumber) {
      return NextResponse.json(
        { error: '주문번호가 필요합니다.' },
        { status: 400 }
      );
    }

    // 메모 저장 또는 업데이트
    const { data, error } = await supabase
      .from('1688_invoice_note')
      .upsert(
        { order_number: orderNumber, note },
        { onConflict: 'order_number' }
      );

    if (error) {
      console.error('메모 저장 오류:', error);
      return NextResponse.json(
        { 
          error: '메모 저장 중 오류가 발생했습니다.', 
          details: error.message 
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: '메모가 저장되었습니다.' 
    });
  } catch (error) {
    console.error('메모 저장 중 예외 발생:', error);
    return NextResponse.json(
      {
        error: '메모 저장 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
} 