import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// 주문번호로 배송정보 조회 API (order_info에서 포함 검색)
export const POST = async (request: NextRequest) => {
  console.log('주문번호 조회 API 호출');

  try {
    const { searchTerm } = await request.json();

    if (!searchTerm || !searchTerm.trim()) {
      return NextResponse.json({
        success: false,
        error: '검색어가 입력되지 않았습니다.'
      }, { status: 400 });
    }

    console.log('조회할 주문번호:', searchTerm);

    // Supabase에서 order_info에 검색어가 포함된 데이터 검색
    const { data, error } = await supabase
      .from('1688_invoice_deliveryInfo_check')
      .select('shop, offer_id, delivery_status, order_id, order_info')
      .ilike('order_info', `%${searchTerm.trim()}%`); // ILIKE는 대소문자 구분 없이 포함 검색

    if (error) {
      console.log('Supabase 조회 오류:', error);
      return NextResponse.json({
        success: false,
        error: '주문정보 조회 중 오류가 발생했습니다.',
        details: error.message
      }, { status: 500 });
    }

    console.log('조회된 주문정보 개수:', data?.length || 0);

    // 데이터를 찾지 못한 경우
    if (!data || data.length === 0) {
      return NextResponse.json({
        success: true,
        message: '해당 주문번호의 정보를 찾을 수 없습니다.',
        data: []
      });
    }

    // 성공적으로 데이터를 찾은 경우
    return NextResponse.json({
      success: true,
      message: `${data.length}건의 주문정보를 조회했습니다.`,
      data: data
    });

  } catch (error) {
    console.error('주문정보 조회 API 오류:', error);
    return NextResponse.json({
      success: false,
      error: '주문정보 조회 중 예외가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
