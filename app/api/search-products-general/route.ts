import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    // URL에서 검색어 파라미터 추출
    const searchParams = request.nextUrl.searchParams;
    const searchTerm = searchParams.get('term');
    
    if (!searchTerm) {
      return NextResponse.json({ 
        error: '검색어가 제공되지 않았습니다.' 
      }, { status: 400 });
    }
    
    console.log(`일반검색 시작: ${searchTerm}`);
    
    // invoice_import_googlesheet 테이블에서 product_name, offer_id, barcode로 검색
    const { data: sheetData, error: sheetError } = await supabase
      .from('invoice_import_googlesheet')
      .select('*')
      .or(`product_name.ilike.%${searchTerm}%,offer_id.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`);
    
    if (sheetError) {
      console.error('일반검색 오류:', sheetError);
      return NextResponse.json({ 
        error: '일반검색 중 오류가 발생했습니다.', 
        details: sheetError.message 
      }, { status: 500 });
    }
    
    // ID가 없는 데이터에 ID 추가
    const dataWithIds = (sheetData || []).map(item => ({
      ...item,
      id: item.id || uuidv4() // ID가 없으면 UUID 생성
    }));
    
    console.log(`일반검색 결과 개수: ${dataWithIds.length}`);
    
    return NextResponse.json({ 
      success: true, 
      data: dataWithIds,
      count: dataWithIds.length
    });
  } catch (error) {
    console.error('일반검색 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '일반검색 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}