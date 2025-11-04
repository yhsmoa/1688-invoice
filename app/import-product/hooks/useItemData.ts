import { useState, useEffect, useMemo } from 'react';

export interface ItemData {
  id: string;
  row_number?: string;
  img_url?: string;
  site_url?: string;
  order_number_prefix?: string;
  order_number: string;
  product_name: string | null;
  product_name_sub?: string | null;
  barcode?: string | null;
  china_option1?: string | null;
  china_option2?: string | null;
  order_qty: number | null;
  cost_main?: string | null;
  cost_sub?: string | null;
  progress_qty?: number | null;
  import_qty?: number | null;
  cancel_qty?: number | null;
  export_qty?: number | null;
  note?: string | null;
  option_id?: string | null;
  product_size?: string | null;
  fabric_blend?: string | null; // W열 - 혼용률
  recommended_age?: string | null; // X열 - 추천연령 (아동용 카테고리 여부 판단)
  order_id?: string | null;
  delivery_status?: string | null;
  date?: string;
  row_id?: string;
  confirm_qty?: number | null;
}

export const useItemData = () => {
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [originalData, setOriginalData] = useState<ItemData[]>([]);
  const [deliveryInfoData, setDeliveryInfoData] = useState<{[key: string]: any}>({});

  // 발송전 카운트를 useMemo로 캐싱 (무한 렌더링 방지)
  const statusCounts = useMemo(() => {
    const counts: { [key: string]: number } = {
      '전체': itemData.length,
      '발송전': 0,
      '부분입고': 0,
      '입고완료': 0,
      '불량': 0,
      '반품': 0
    };

    // 발송전 카운트 계산
    counts['발송전'] = itemData.filter(item => {
      const deliveryStatus = item.delivery_status;
      return deliveryStatus === '等待卖家发货' || !deliveryStatus || deliveryStatus.trim() === '';
    }).length;

    return counts;
  }, [itemData]);

  // 배송정보 매핑 함수
  const mapDeliveryInfoToItems = (items: ItemData[]): ItemData[] => {
    let matchedCount = 0;
    let unmatchedCount = 0;
    const unmatchedItems: any[] = [];

    const result = items.map((item) => {
      const itemBarcode = item.barcode?.toString().trim();

      if (!itemBarcode) {
        unmatchedCount++;
        unmatchedItems.push({
          order_number: item.order_number,
          barcode: '바코드없음',
          product_name: item.product_name
        });
        return item;
      }

      let matchedDeliveryInfo = null;

      // 특정 바코드 디버깅
      const isDebugBarcode = itemBarcode === 'S0024873459432';

      for (const [, deliveryInfo] of Object.entries(deliveryInfoData)) {
        if (deliveryInfo.order_info) {
          const orderInfoLines = deliveryInfo.order_info.split('\n').filter((line: string) => line.trim());

          for (const line of orderInfoLines) {
            if (isDebugBarcode && line.includes('BZ-251007-0183')) {
              console.log('🔍 디버깅: BZ-251007-0183 발견!');
              console.log('  라인 내용:', line);
              console.log('  검색 바코드:', itemBarcode);
              console.log('  includes 결과:', line.includes(itemBarcode));
              console.log('  delivery_code:', deliveryInfo.delivery_code);
            }

            if (line.includes(itemBarcode)) {
              matchedDeliveryInfo = deliveryInfo;
              break;
            }
          }

          if (matchedDeliveryInfo) {
            break;
          }
        }
      }

      if (matchedDeliveryInfo) {
        matchedCount++;
        return {
          ...item,
          order_id: matchedDeliveryInfo.order_id || null,
          delivery_status: matchedDeliveryInfo.delivery_status || null
        };
      } else {
        unmatchedCount++;
        unmatchedItems.push({
          order_number: item.order_number,
          barcode: itemBarcode,
          product_name: item.product_name
        });
      }

      return item;
    });

    console.log('=== 매칭 실패 목록 ===');
    console.log(`총 ${unmatchedCount}개 실패`);
    unmatchedItems.forEach((item, index) => {
      console.log(`[${index + 1}] 주문번호: ${item.order_number}, 바코드: ${item.barcode}, 상품명: ${item.product_name}`);
    });
    console.log('===================');

    return result;
  };

  // 모든 배송정보 초기 로딩
  const fetchAllDeliveryInfo = async () => {
    try {
      console.log('배송정보 전체 로딩 시작...');

      const response = await fetch('/api/get-all-delivery-info');
      const result = await response.json();

      if (result.success && result.data) {
        const deliveryMap: {[key: string]: any} = {};

        // 처음 3개 샘플 데이터 출력
        console.log('샘플 배송정보 데이터:', result.data.slice(0, 3));

        result.data.forEach((item: any) => {
          if (item.delivery_code) {
            deliveryMap[item.delivery_code] = item;
          }
        });

        setDeliveryInfoData(deliveryMap);
        console.log(`배송정보 ${result.data.length}개 로딩 완료`);
        console.log('deliveryMap 키 샘플:', Object.keys(deliveryMap).slice(0, 10));
      } else {
        console.log('배송정보 로딩 실패 또는 데이터 없음');
      }
    } catch (error) {
      console.error('배송정보 로딩 오류:', error);
    }
  };

  // 데이터 가져오기 - 초기에는 빈 데이터
  const fetchItemData = async () => {
    console.log('fetchItemData 시작');
    setOriginalData([]);
    setItemData([]);
    setLoading(false);
  };

  useEffect(() => {
    fetchItemData();
    fetchAllDeliveryInfo();
  }, []);

  return {
    itemData,
    setItemData,
    loading,
    setLoading,
    originalData,
    setOriginalData,
    deliveryInfoData,
    statusCounts,
    mapDeliveryInfoToItems,
    fetchAllDeliveryInfo
  };
};
