import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// Next.js 14 API 라우트 형식으로 수정
export const GET = async () => {
  try {
    console.log('GET /api/get-stats 호출됨');
    
    // 1. 거래완료(交易成功) 주문 데이터 가져오기
    const { data: completedOrders, error: completedError } = await supabase
      .from('1688_invoice')
      .select('order_number, unit_price, order_qty')
      .eq('order_status', '交易成功');

    if (completedError) {
      console.error('거래완료 주문 조회 오류:', completedError);
      return NextResponse.json({ 
        error: '데이터를 가져오는 중 오류가 발생했습니다.',
        details: completedError.message
      }, { status: 500 });
    }

    // 2. 영수증 발행(img_upload=true) + 거래완료 주문 데이터 가져오기
    const { data: receiptOrders, error: receiptError } = await supabase
      .from('1688_invoice')
      .select('order_number, unit_price, order_qty')
      .eq('order_status', '交易成功')
      .eq('img_upload', true);

    if (receiptError) {
      console.error('영수증 발행 주문 조회 오류:', receiptError);
      return NextResponse.json({ 
        error: '데이터를 가져오는 중 오류가 발생했습니다.',
        details: receiptError.message
      }, { status: 500 });
    }

    // 3. 주문번호 중복 제거 (Set 사용)
    const completedOrderNumbers = new Set(completedOrders.map(item => item.order_number));
    const receiptOrderNumbers = new Set(receiptOrders.map(item => item.order_number));

    // 4. 총 금액 계산
    const completedAmount = completedOrders.reduce((sum, item) => {
      return sum + (item.unit_price || 0) * (item.order_qty || 0);
    }, 0);

    const receiptAmount = receiptOrders.reduce((sum, item) => {
      return sum + (item.unit_price || 0) * (item.order_qty || 0);
    }, 0);

    // 5. 총 상품 개수 계산
    const completedProductCount = completedOrders.reduce((sum, item) => {
      return sum + (item.order_qty || 0);
    }, 0);

    const receiptProductCount = receiptOrders.reduce((sum, item) => {
      return sum + (item.order_qty || 0);
    }, 0);

    // 6. 달성률 계산 (0으로 나누기 방지)
    const orderCountPercentage = completedOrderNumbers.size > 0 
      ? (receiptOrderNumbers.size / completedOrderNumbers.size) * 100 
      : 0;
    
    const amountPercentage = completedAmount > 0 
      ? (receiptAmount / completedAmount) * 100 
      : 0;
    
    const productCountPercentage = completedProductCount > 0 
      ? (receiptProductCount / completedProductCount) * 100 
      : 0;

    // 7. 결과 반환
    const result = {
      orderCount: {
        receipt: receiptOrderNumbers.size,
        completed: completedOrderNumbers.size,
        percentage: orderCountPercentage
      },
      totalAmount: {
        receipt: receiptAmount,
        completed: completedAmount,
        percentage: amountPercentage
      },
      productCount: {
        receipt: receiptProductCount,
        completed: completedProductCount,
        percentage: productCountPercentage
      }
    };

    console.log('통계 데이터:', result);

    // 캐시 방지 헤더 추가
    const response = NextResponse.json(result);
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    console.error('통계 데이터 가져오기 오류:', error);
    return NextResponse.json({ 
      error: '데이터를 가져오는 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 