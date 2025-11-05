import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// 배송번호로 배송정보 조회 API
export const POST = async (request: NextRequest) => {
  console.log('배송정보 조회 API 호출');

  try {
    const { deliveryCode } = await request.json();

    if (!deliveryCode || !deliveryCode.trim()) {
      return NextResponse.json({
        success: false,
        error: '배송번호가 입력되지 않았습니다.'
      }, { status: 400 });
    }

    console.log('조회할 배송번호:', deliveryCode);

    // Supabase에서 delivery_code로 검색
    const { data, error } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('*')
      .eq('delivery_code', deliveryCode.trim())
      .single(); // 단일 결과 기대

    if (error) {
      console.log('Supabase 조회 오류:', error);

      // 데이터를 찾을 수 없는 경우와 다른 오류를 구분
      if (error.code === 'PGRST116') {
        return NextResponse.json({
          success: false,
          message: '해당 배송번호의 정보를 찾을 수 없습니다.',
          data: null
        });
      }

      return NextResponse.json({
        success: false,
        error: '배송정보 조회 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    console.log('조회된 배송정보:', data);

    // 성공적으로 데이터를 찾은 경우
    return NextResponse.json({
      success: true,
      message: '배송정보를 성공적으로 조회했습니다.',
      data: data
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