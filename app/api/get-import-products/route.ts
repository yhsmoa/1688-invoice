import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    console.log('상품 데이터 가져오기 API 호출');
    
    // Supabase에서 데이터 조회
    const { data, error } = await supabase
      .from('invoice_import_googlesheet')
      .select('*');
    
    if (error) {
      console.error('Supabase 조회 오류:', error);
      return NextResponse.json({ 
        error: '데이터를 가져오는데 실패했습니다.', 
        details: error.message 
      }, { status: 500 });
    }
    
    // ID를 row_id 값으로 설정 (row_id가 primary key이므로)
    const dataWithIds = data.map(item => ({
      ...item,
      id: item.row_id || uuidv4() // row_id 값을 id로 사용, 없으면 UUID 생성
    }));
    
    // row_id를 숫자로 변환하여 정렬
    const sortedData = dataWithIds.sort((a, b) => {
      const aNum = a.row_id ? parseInt(a.row_id) : 0;
      const bNum = b.row_id ? parseInt(b.row_id) : 0;
      return aNum - bNum;
    });
    
    console.log(`${sortedData.length}개의 상품 데이터 조회 완료`);
    
    return NextResponse.json({ 
      success: true, 
      data: sortedData,
      count: sortedData.length
    });
  } catch (error) {
    console.error('상품 데이터 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '상품 데이터 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 