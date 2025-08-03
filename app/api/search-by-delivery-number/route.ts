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
    
    console.log(`배송번호로 검색 시작: ${searchTerm}`);
    
    // 1. 1688_invoice 테이블에서 delivery_number1로 검색하여 offer_id 찾기
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('1688_invoice')
      .select('offer_id')
      .ilike('delivery_number1', `%${searchTerm}%`);
    
    if (invoiceError) {
      console.error('1688_invoice 검색 오류:', invoiceError);
      return NextResponse.json({ 
        error: '배송번호 검색 중 오류가 발생했습니다.', 
        details: invoiceError.message 
      }, { status: 500 });
    }
    
    if (!invoiceData || invoiceData.length === 0) {
      console.log('검색된 배송번호 없음');
      return NextResponse.json({ 
        success: true, 
        data: [],
        count: 0
      });
    }
    
    // 찾은 offer_id 목록 추출
    const offerIds = invoiceData.map(item => item.offer_id).filter(Boolean);
    console.log(`검색된 offer_id 개수: ${offerIds.length}`);
    
    if (offerIds.length === 0) {
      return NextResponse.json({ 
        success: true, 
        data: [],
        count: 0
      });
    }
    
    // 2. invoice_import_googlesheet 테이블에서 offer_id로 검색
    const { data: sheetData, error: sheetError } = await supabase
      .from('invoice_import_googlesheet')
      .select('*')
      .in('offer_id', offerIds);
    
    if (sheetError) {
      console.error('invoice_import_googlesheet 검색 오류:', sheetError);
      return NextResponse.json({ 
        error: 'offer_id로 상품 검색 중 오류가 발생했습니다.', 
        details: sheetError.message 
      }, { status: 500 });
    }
    
    // ID가 없는 데이터에 ID 추가
    const dataWithIds = (sheetData || []).map(item => ({
      ...item,
      id: item.id || uuidv4() // ID가 없으면 UUID 생성
    }));
    
    console.log(`검색 결과 개수: ${dataWithIds.length}`);
    
    return NextResponse.json({ 
      success: true, 
      data: dataWithIds,
      count: dataWithIds.length
    });
  } catch (error) {
    console.error('검색 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '검색 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 