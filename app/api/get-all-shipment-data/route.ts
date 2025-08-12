import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('전체 쉽먼트 데이터 조회 시작');

    // 전체 쉽먼트 데이터 조회
    const { data, error } = await supabase
      .from('1688_shipment')
      .select('*')  
      .order('box', { ascending: true });

    if (error) {
      console.error('전체 쉽먼트 데이터 조회 오류:', error);
      return NextResponse.json(
        { success: false, error: '쉽먼트 데이터 조회에 실패했습니다.' },
        { status: 500 }
      );
    }

    // UI에 맞는 형태로 데이터 변환
    const transformedData = data.map(item => ({
      id: item.id,
      box_number: item.box,
      barcode: item.barcode,
      product_name: item.product_name,
      order_option: item.option_name,
      quantity: item.qty
    }));

    console.log('전체 쉽먼트 데이터 조회 완료:', transformedData.length, '개 항목');

    return NextResponse.json({
      success: true,
      data: transformedData,
      count: transformedData.length
    });
  } catch (error) {
    console.error('전체 쉽먼트 데이터 처리 중 오류:', error);
    return NextResponse.json(
      { success: false, error: '쉽먼트 데이터 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}