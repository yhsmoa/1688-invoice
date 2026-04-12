import { useState } from 'react';
import { ItemData, Order1688Data } from './useItemData';

export const useSearch = (
  itemData: ItemData[],
  deliveryInfoData: any[],
  orders1688Data: Order1688Data[] = []
) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<string>('배송번호');

  // ============================================================
  // 주문번호 정규화 (3파트: 사업자코드-날짜-순번)
  // ============================================================
  const truncateOrderNumber = (orderNum: string): string => {
    if (!orderNum) return '';
    const parts = orderNum.toString().split('-');
    return parts.slice(0, 3).join('-');
  };

  // ============================================================
  // 배송번호 → order_id → 1688_order_id → order_number 매칭 검색
  // ============================================================
  const searchBy1688OrderId = (deliveryCode: string) => {
    const matchingDeliveryInfos = deliveryInfoData.filter((info: any) =>
      info.delivery_code?.toLowerCase().includes(deliveryCode.toLowerCase())
    );

    if (matchingDeliveryInfos.length === 0) return [];

    const orderIds = matchingDeliveryInfos
      .map((info: any) => info.order_id)
      .filter((id: any) => id);

    if (orderIds.length === 0) return [];

    const matchingOrders = orders1688Data.filter((order: Order1688Data) =>
      orderIds.includes(order['1688_order_id'])
    );

    if (matchingOrders.length === 0) return [];

    return matchingOrders.map((order: Order1688Data) =>
      truncateOrderNumber(order.order_number)
    );
  };

  // ============================================================
  // 배송번호로 메모리에서 배송정보 조회 (모든 매칭 항목 반환)
  // ============================================================
  const searchDeliveryInfo = (deliveryCode: string) => {
    const matchingInfos = deliveryInfoData.filter((info: any) =>
      info.delivery_code?.toLowerCase().includes(deliveryCode.toLowerCase())
    );

    return matchingInfos.length > 0 ? matchingInfos : [];
  };

  // ============================================================
  // order_info 파싱 및 검색
  // ============================================================
  const parseOrderInfoAndSearch = (orderInfo: string) => {
    const lines = orderInfo.split('\n').filter(line => line.trim());
    const searchResults: ItemData[] = [];

    lines.forEach(line => {
      let matchingItems: ItemData[] = [];

      // 패턴 1: 새 형식 — 글번호 // 옵션1 | 옵션2 // 바코드 // 개수ea
      const newFormatMatch = line.match(/^(.+?)\s*\/\/\s*(.+?)\s*\|\s*(.+?)\s*\/\/\s*(\S+)\s*\/\/\s*(\d+)ea$/);

      if (newFormatMatch) {
        const [, orderNumber, , , barcode] = newFormatMatch;

        matchingItems = itemData.filter((item) => {
          const itemOrderNumber = (item.order_number || '').toString().trim();
          const itemBarcode = (item.barcode || '').toString().trim();
          return itemOrderNumber === orderNumber.trim() && itemBarcode === barcode.trim();
        });

        searchResults.push(...matchingItems);
      } else {
        // 패턴 2: 기존 형식 — MMDD - 옵션1 | 옵션2 - 바코드 - 개수?
        const oldFormatMatch = line.match(/^(\d{4})\s*-\s*(.+?)\s*\|\s*(.+?)\s*-\s*(\S+)\s*-\s*(\d+)\?$/);

        if (oldFormatMatch) {
          const [, dateMMDD, , , barcode] = oldFormatMatch;

          matchingItems = itemData.filter(item => {
            const orderPrefix = (item.order_number_prefix || '').toString();
            const itemDate = orderPrefix.slice(-4);
            const itemBarcode = (item.barcode || '').toString();
            return itemDate === dateMMDD && itemBarcode === barcode;
          });

          searchResults.push(...matchingItems);
        }
      }
    });

    return searchResults;
  };

  // ============================================================
  // 검색 실행
  // ============================================================
  const performSearch = async (
    activeStatus: string,
    sortType: string,
    sortData: (data: ItemData[], sortType: string) => ItemData[],
    filterByStatus: (data: ItemData[], status: string) => ItemData[],
    setLoading: (loading: boolean) => void,
    setFilteredData: (data: ItemData[]) => void,
    setCurrentPage: (page: number) => void
  ) => {
    if (!searchTerm.trim()) {
      const filteredByStatus = filterByStatus(itemData, activeStatus);
      const sortedData = sortData(filteredByStatus, sortType);
      setFilteredData(sortedData);
      setCurrentPage(1);
      return;
    }

    try {
      setLoading(true);
      let searchResults: ItemData[] = [];

      if (searchType === '배송번호') {
        // 1차: deliveryInfoData에서 배송번호 → sheet_order_number 매칭
        const deliveryInfos = searchDeliveryInfo(searchTerm);

        if (deliveryInfos.length > 0) {
          const sheetOrderNumbers = deliveryInfos.map((info: any) =>
            truncateOrderNumber(info.sheet_order_number)
          );

          searchResults = itemData.filter(item =>
            sheetOrderNumbers.includes(truncateOrderNumber(item.order_number || ''))
          );
        }

        // 2차: 1차 실패 시 1688_order_id 방식 시도
        if (searchResults.length === 0) {
          const orderNumbersFrom1688 = searchBy1688OrderId(searchTerm);

          if (orderNumbersFrom1688.length > 0) {
            searchResults = itemData.filter(item =>
              orderNumbersFrom1688.includes(truncateOrderNumber(item.order_number || ''))
            );
          }
        }
      } else if (searchType === '일반검색') {
        searchResults = itemData.filter(item => {
          const term = searchTerm.toLowerCase();
          return (
            (item.product_name || '').toString().toLowerCase().includes(term) ||
            (item.product_name_sub || '').toString().toLowerCase().includes(term) ||
            (item.barcode || '').toString().toLowerCase().includes(term) ||
            (item.china_option1 || '').toString().toLowerCase().includes(term) ||
            (item.china_option2 || '').toString().toLowerCase().includes(term) ||
            (item.order_number || '').toString().toLowerCase().includes(term)
          );
        });
      }

      const filteredByStatus = filterByStatus(searchResults, activeStatus);
      const sortedData = sortData(filteredByStatus, sortType);
      setFilteredData(sortedData);

    } catch (error) {
      console.error('검색 오류:', error);
      alert('검색 중 오류가 발생했습니다.');
      setFilteredData([]);
    } finally {
      setLoading(false);
      setCurrentPage(1);
    }
  };

  return {
    searchTerm,
    setSearchTerm,
    searchType,
    setSearchType,
    performSearch,
    searchDeliveryInfo,
    searchBy1688OrderId,
    parseOrderInfoAndSearch
  };
};
