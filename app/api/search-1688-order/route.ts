import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderData, user_id } = body;

    if (!orderData || !Array.isArray(orderData) || orderData.length === 0) {
      return NextResponse.json({ success: false, error: 'orderData 배열이 필요합니다.' }, { status: 400 });
    }

    // order_number 추출 (# 또는 C 앞부분만 사용)
    const extractBaseOrderNumber = (orderNumber: string): string => {
      // # 또는 C 중 먼저 나오는 위치에서 자르기
      let result = orderNumber;
      const hashIndex = orderNumber.indexOf('#');
      const cIndex = orderNumber.search(/C\d*$/); // 끝에 C와 숫자가 붙는 패턴

      if (hashIndex > 0) {
        result = orderNumber.substring(0, hashIndex);
      }
      if (cIndex > 0) {
        const tempResult = orderNumber.substring(0, cIndex);
        if (tempResult.length < result.length) {
          result = tempResult;
        }
      }
      return result;
    };

    const orderNumbers = orderData
      .map((item: { id: string; order_number: string | null }) => {
        if (!item.order_number) return null;
        return extractBaseOrderNumber(item.order_number);
      })
      .filter((num): num is string => num !== null && num !== '');

    if (orderNumbers.length === 0) {
      return NextResponse.json({ success: false, error: '조회할 주문번호가 없습니다.' }, { status: 400 });
    }

    // 1688_invoice_deliveryInfo_check 테이블에서 order_id 검색 (배치 처리)
    let allDeliveryData: any[] = [];
    const batchSize = 1000;

    for (let i = 0; i < orderNumbers.length; i += batchSize) {
      const batch = orderNumbers.slice(i, i + batchSize);

      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('sheet_order_number, order_id')
        .in('sheet_order_number', batch);

      if (error) {
        return NextResponse.json({
          success: false,
          error: '1688 주문 정보 조회 실패',
          details: error.message
        }, { status: 500 });
      }

      if (data) {
        allDeliveryData = allDeliveryData.concat(data);
      }
    }

    // order_number -> order_id 매핑
    const orderMapping: { [key: string]: string } = {};
    allDeliveryData.forEach((item) => {
      if (item.sheet_order_number && item.order_id) {
        orderMapping[item.sheet_order_number] = item.order_id;
      }
    });

    // invoiceManager_refundOrder 테이블 업데이트 (배치 처리)
    const updateBatchSize = 100;
    let successCount = 0;

    for (let i = 0; i < orderData.length; i += updateBatchSize) {
      const batch = orderData.slice(i, i + updateBatchSize);

      const updatePromises = batch.map((item: { id: string; order_number: string | null }) => {
        // # 또는 C 앞부분만 추출하여 매핑 조회
        const searchKey = item.order_number ? extractBaseOrderNumber(item.order_number) : null;
        const orderId = searchKey ? orderMapping[searchKey] : null;

        if (!orderId) {
          return Promise.resolve({ error: null, data: null, notFound: item.order_number });
        }

        return supabase
          .from('invoiceManager_refundOrder')
          .update({
            '1688_order_number': orderId,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id)
          .select();
      });

      const results = await Promise.all(updatePromises);

      // 성공 카운트
      successCount += results.filter(r => r.data && r.data.length > 0).length;

      // 에러 체크
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error('일부 업데이트 실패:', errors);
      }
    }

    // 찾지 못한 주문번호
    const notFound = orderData
      .filter((item: { id: string; order_number: string | null }) => {
        const searchKey = item.order_number ? extractBaseOrderNumber(item.order_number) : null;
        return item.order_number && searchKey && !orderMapping[searchKey];
      }
      )
      .map((item: { id: string; order_number: string | null }) => item.order_number);

    return NextResponse.json({
      success: true,
      data: {
        total: orderData.length,
        found: Object.keys(orderMapping).length,
        notFound,
        orderMapping
      }
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '1688 주문 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
