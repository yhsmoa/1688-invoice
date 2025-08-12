import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { ids } = await request.json();
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: '선택된 상품 ID가 없습니다.' 
      }, { status: 400 });
    }
    
    console.log('선택된 상품 조회:', ids);
    
    // Supabase에서 선택된 상품들 조회
    const { data, error } = await supabase
      .from('invoice_import_googlesheet')
      .select('row_id, product_name, option_name, barcode, china_option1, china_option2')
      .in('row_id', ids)
      .order('row_id', { ascending: true });
    
    if (error) {
      console.error('상품 조회 오류:', error);
      return NextResponse.json({ 
        success: false, 
        error: '상품 데이터 조회에 실패했습니다.',
        details: error.message 
      }, { status: 500 });
    }
    
    // 데이터가 없는 경우 처리
    if (!data || data.length === 0) {
      console.log('조회된 상품이 없습니다.');
      return NextResponse.json({ 
        success: true, 
        data: [],
        count: 0
      });
    }
    
    // 데이터 변환 (row_id를 id로 사용)
    const transformedData = data.map(item => ({
      id: item.row_id,
      product_name: item.product_name,
      option_name: item.option_name,
      barcode: item.barcode,
      china_option1: item.china_option1,
      china_option2: item.china_option2
    }));
    
    console.log(`${transformedData.length}개의 상품 데이터 조회 완료`);
    
    return NextResponse.json({ 
      success: true, 
      data: transformedData,
      count: transformedData.length
    });
    
  } catch (error) {
    console.error('선택된 상품 조회 처리 중 오류:', error);
    return NextResponse.json({ 
      success: false,
      error: '상품 조회 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}