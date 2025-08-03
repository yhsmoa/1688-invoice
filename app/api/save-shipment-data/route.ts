import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { shipmentData } = await request.json();

    if (!shipmentData || !Array.isArray(shipmentData)) {
      return NextResponse.json(
        { success: false, error: '쉽먼트 데이터가 유효하지 않습니다.' },
        { status: 400 }
      );
    }

    console.log('쉽먼트 저장 요청:', shipmentData);

    // 각 쉽먼트 항목 저장
    const insertPromises = shipmentData.map(async (item: any) => {
      const { error } = await supabase
        .from('1688_shipment')
        .insert({
          box: item.box_number,
          barcode: item.barcode,
          product_name: item.product_name,
          option_name: item.order_option,
          qty: item.quantity
        });

      if (error) {
        console.error(`쉽먼트 항목 저장 오류:`, error);
        throw error;
      }
    });

    await Promise.all(insertPromises);

    console.log('쉽먼트 데이터 저장 완료');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('쉽먼트 데이터 저장 오류:', error);
    return NextResponse.json(
      { success: false, error: '쉽먼트 데이터 저장에 실패했습니다.' },
      { status: 500 }
    );
  }
}