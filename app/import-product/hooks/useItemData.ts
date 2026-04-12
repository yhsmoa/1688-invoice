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

// 1688 주문 데이터 인터페이스
export interface Order1688Data {
  id: string;
  order_number: string;
  '1688_order_id': string | null;
  barcode: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  order_qty: number | null;
  status_import: number | null;
  status_cancel: number | null;
  img_url: string | null;
  site_url: string | null;
  coupang_shipment_size: string | null;
  composition: string | null;
  recomanded_age: string | null;
}

export const useItemData = () => {
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [originalData, setOriginalData] = useState<ItemData[]>([]);
  const [deliveryInfoData, setDeliveryInfoData] = useState<any[]>([]);
  const [orders1688Data, setOrders1688Data] = useState<Order1688Data[]>([]);

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

      // order_number로 매칭
      const itemOrderNumber = item.order_number?.toString().trim();

      if (itemOrderNumber) {
        matchedDeliveryInfo = deliveryInfoData.find((deliveryInfo: any) =>
          deliveryInfo.sheet_order_number === itemOrderNumber
        );
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

    return result;
  };

  // 모든 배송정보 초기 로딩
  const fetchAllDeliveryInfo = async () => {
    try {
      const response = await fetch('/api/get-all-delivery-info');
      const result = await response.json();

      if (result.success && result.data) {
        setDeliveryInfoData(result.data);
      }
    } catch (error) {
      console.error('배송정보 로딩 오류:', error);
    }
  };

  // invoiceManager_1688_orders 데이터 로딩
  const fetchAll1688Orders = async () => {
    try {
      const response = await fetch('/api/get-1688-orders');
      const result = await response.json();

      if (result.success && result.data) {
        setOrders1688Data(result.data);
      }
    } catch (error) {
      console.error('1688 주문 데이터 로딩 오류:', error);
    }
  };

  // 데이터 가져오기 - 초기에는 빈 데이터
  const fetchItemData = async () => {
    setOriginalData([]);
    setItemData([]);
    setLoading(false);
  };

  useEffect(() => {
    fetchItemData();
  }, []);

  return {
    itemData,
    setItemData,
    loading,
    setLoading,
    originalData,
    setOriginalData,
    deliveryInfoData,
    orders1688Data,
    statusCounts,
    mapDeliveryInfoToItems,
    fetchAllDeliveryInfo,
    fetchAll1688Orders
  };
};
