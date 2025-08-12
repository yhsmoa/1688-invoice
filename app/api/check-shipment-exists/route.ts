import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const box = searchParams.get('box');
    const barcode = searchParams.get('barcode');

    if (!box || !barcode) {
      return NextResponse.json(
        { success: false, error: 'box와 barcode 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log('쉽먼트 존재 여부 확인:', { box, barcode });

    // DB에서 동일한 box + barcode 조합 검색
    const { data, error } = await supabase
      .from('1688_shipment')
      .select('*')
      .eq('box', box)
      .eq('barcode', barcode)
      .single(); // 단일 결과 예상

    if (error) {
      if (error.code === 'PGRST116') {
        // 데이터가 없는 경우 (정상적인 상황)
        console.log('해당 조합 데이터 없음:', { box, barcode });
        return NextResponse.json({ 
          success: true, 
          exists: false, 
          data: null 
        });
      } else {
        console.error('쉽먼트 검색 오류:', error);
        throw error;
      }
    }

    console.log('기존 데이터 발견:', data);
    return NextResponse.json({ 
      success: true, 
      exists: true, 
      data: data 
    });

  } catch (error) {
    console.error('쉽먼트 존재 확인 오류:', error);
    return NextResponse.json(
      { success: false, error: '쉽먼트 존재 확인에 실패했습니다.' },
      { status: 500 }
    );
  }
}