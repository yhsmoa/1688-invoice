import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const box = searchParams.get('box');

    if (!box) {
      return NextResponse.json(
        { success: false, error: '박스 번호가 필요합니다.' },
        { status: 400 }
      );
    }

    console.log(`박스별 쉽먼트 데이터 조회: ${box}`);

    const { data, error } = await supabase
      .from('1688_shipment')
      .select('*')
      .eq('box', box)
      .order('id', { ascending: false });

    if (error) {
      console.error('쉽먼트 데이터 조회 오류:', error);
      return NextResponse.json(
        { success: false, error: '쉽먼트 데이터 조회에 실패했습니다.' },
        { status: 500 }
      );
    }

    console.log(`${box} 박스 데이터 조회 완료:`, data?.length || 0, '개 항목');

    return NextResponse.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('박스별 쉽먼트 데이터 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}