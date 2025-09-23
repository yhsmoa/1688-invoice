import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// 모든 배송정보 조회 API (초기 로딩용)
export const GET = async (request: NextRequest) => {
  console.log('모든 배송정보 조회 API 호출');

  try {
    // Supabase에서 모든 배송정보 조회
    const { data, error } = await supabase
      .from('1688_invoice_deliveryInfo')
      .select('*')
      .order('delivery_code', { ascending: true });

    if (error) {
      console.error('Supabase 조회 오류:', error);
      return NextResponse.json({
        success: false,
        error: '배송정보 조회 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    console.log(`총 ${data?.length || 0}개의 배송정보를 조회했습니다.`);

    return NextResponse.json({
      success: true,
      message: `${data?.length || 0}개의 배송정보를 조회했습니다.`,
      data: data || [],
      count: data?.length || 0
    });

  } catch (error) {
    console.error('배송정보 조회 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: '배송정보 조회 중 예외가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};