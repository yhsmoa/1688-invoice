/**
 * 배송정보 매칭 유틸리티
 */

import { OrderCheckData } from '../../../order-check/OrderCheck';

export interface DeliveryInfo {
  id: string;
  order_id: string;
  shop: string;
  delivery_status: string;
  order_payment_time: string | null;
  offer_id: string;
  order_info: string;
  delivery_code: string;
  sheet_order_number: string; // 추출된 주문번호 (매칭용)
}

/**
 * order_info에서 주문번호 추출
 * 예: "BO-251016-0096 // 灰色 | 130cm // S0033722132260 // 1ea"
 * -> "BO-251016-0096"
 */
export function extractOrderNumber(orderInfo: string): string | null {
  if (!orderInfo || typeof orderInfo !== 'string') {
    return null;
  }

  // "//" 기준으로 분리하여 첫 번째 부분 추출
  const parts = orderInfo.split('//');
  if (parts.length > 0) {
    const orderNumber = parts[0].trim();
    // 주문번호 형식 검증 (예: BO-251016-0096)
    if (orderNumber && orderNumber.length > 0) {
      return orderNumber;
    }
  }

  return null;
}

/**
 * delivery_status를 한글로 변환
 */
export function translateDeliveryStatus(status: string): string {
  const statusMap: { [key: string]: string } = {
    '等待买家确认收货': '等待买家确认收货 | 수령대기',
    '等待卖家发货': '等待卖家发货 | 판매자 배송 전',
    '交易关闭': '交易关闭 | 거래 종료',
    '退款中': '退款中 | 환불 진행 중',
    '交易成功': '交易成功 | 거래 성공',
  };

  return statusMap[status] || status;
}

/**
 * 글번호(order_number_prefix + order_number)와 delivery_info 매칭
 */
export function matchDeliveryInfo(
  items: OrderCheckData[],
  deliveryInfoList: DeliveryInfo[]
): OrderCheckData[] {
  console.log('=== 배송정보 매칭 시작 ===');
  console.log('아이템 개수:', items.length);
  console.log('배송정보 개수:', deliveryInfoList.length);

  // 배송정보가 없으면 경고
  if (deliveryInfoList.length === 0) {
    console.warn('⚠️ 배송정보가 비어있습니다! 엑셀을 먼저 업로드하세요.');
    return items;
  }

  let matchedCount = 0;
  let unmatchedCount = 0;
  const failedMatches: string[] = [];

  const result = items.map((item, index) => {
    // B열의 주문번호를 그대로 사용 (예: "BZ-250919-0158")
    const fullOrderNumber = item.order_number?.trim() || '';

    if (!fullOrderNumber) {
      unmatchedCount++;
      return item;
    }

    // deliveryInfoList에서 sheet_order_number로 직접 매칭
    const matchedDelivery = deliveryInfoList.find(
      (info) => info.sheet_order_number === fullOrderNumber
    );

    if (matchedDelivery) {
      matchedCount++;
      return {
        ...item,
        delivery_shop: matchedDelivery.shop,
        delivery_order_id: matchedDelivery.order_id,
        delivery_status: matchedDelivery.delivery_status,
        delivery_code: matchedDelivery.delivery_code,
        order_payment_time: matchedDelivery.order_payment_time,
      };
    } else {
      unmatchedCount++;

      // 실패한 항목 저장 (처음 10개만)
      if (failedMatches.length < 10) {
        failedMatches.push(fullOrderNumber);
      }
    }

    return item;
  });

  console.log(`\n매칭 성공: ${matchedCount}개, 실패: ${unmatchedCount}개`);

  if (failedMatches.length > 0) {
    console.log('\n❌ 매칭 실패한 주문번호 샘플 (처음 10개):');
    failedMatches.forEach((orderNum, idx) => {
      console.log(`  ${idx + 1}. "${orderNum}"`);

      // Supabase에 비슷한 주문번호가 있는지 확인
      const prefix = orderNum.substring(0, Math.min(8, orderNum.length));
      const similar = deliveryInfoList.find(info =>
        info.sheet_order_number?.startsWith(prefix)
      );

      if (similar) {
        console.log(`     → Supabase에서 비슷한 것 발견: "${similar.sheet_order_number}"`);
      } else {
        console.log(`     → Supabase에 해당 주문번호 없음`);
      }
    });
  }

  console.log('=== 배송정보 매칭 완료 ===');

  return result;
}

/**
 * 정보열에 표시할 텍스트 포맷팅
 * 순서: shop -> order_id -> delivery_status -> delivery_code -> order_payment_time
 */
export function formatInfoColumn(item: OrderCheckData & {
  delivery_shop?: string;
  delivery_order_id?: string;
  delivery_status?: string;
  delivery_code?: string;
  order_payment_time?: string | null;
}): string {
  const parts: string[] = [];

  if (item.delivery_shop) {
    parts.push(item.delivery_shop);
  }

  if (item.delivery_order_id) {
    parts.push(item.delivery_order_id);
  }

  if (item.delivery_status) {
    const translatedStatus = translateDeliveryStatus(item.delivery_status);
    parts.push(translatedStatus);
  }

  if (item.delivery_code) {
    // delivery_code는 줄바꿈으로 여러 개일 수 있음
    parts.push(item.delivery_code);
  }

  if (item.order_payment_time) {
    // order_payment_time을 마지막에 추가
    parts.push(item.order_payment_time);
  }

  return parts.join('\n');
}
