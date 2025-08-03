import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // 모든 상품 메모 데이터 조회
    const { data, error } = await supabase
      .from('item_note')
      .select('*');

    if (error) {
      console.error('상품 메모 조회 오류:', error);
      return NextResponse.json(
        { 
          error: '상품 메모 조회 중 오류가 발생했습니다.', 
          details: error.message 
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('상품 메모 조회 중 예외 발생:', error);
    return NextResponse.json(
      {
        error: '상품 메모 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
} 