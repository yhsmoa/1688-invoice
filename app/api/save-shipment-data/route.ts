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

    // 각 쉽먼트 항목 처리 (upsert 방식으로 중복 방지)
    const upsertPromises = shipmentData.map(async (item: any) => {
      console.log('저장할 개별 항목:', item);
      
      // Box-barcode 조합으로 고유 ID 생성
      const uniqueId = `${item.box}-${item.barcode}`;
      
      const { error } = await supabase
        .from('1688_shipment')
        .upsert({
          id: uniqueId,
          box: item.box,
          barcode: item.barcode,
          product_name: item.product_name,
          option_name: item.option_name,
          qty: item.qty
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error(`쉽먼트 항목 저장 오류:`, error);
        throw error;
      }
    });

    await Promise.all(upsertPromises);

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