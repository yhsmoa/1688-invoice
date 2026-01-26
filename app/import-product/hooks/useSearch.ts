import { useState } from 'react';
import { ItemData, Order1688Data } from './useItemData';

export const useSearch = (
  itemData: ItemData[],
  deliveryInfoData: any[],
  orders1688Data: Order1688Data[] = []
) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<string>('배송번호');

  // 주문번호 정규화 함수 (전역에서 사용)
  const truncateOrderNumber = (orderNum: string): string => {
    if (!orderNum) return '';
    const parts = orderNum.toString().split('-');
    return parts.slice(0, 3).join('-');
  };

  // 배송번호 → order_id → 1688_order_id → order_number 매칭 검색
  const searchBy1688OrderId = (deliveryCode: string) => {
    console.log('=== searchBy1688OrderId 시작 ===');
    console.log('1. 검색할 배송번호:', deliveryCode);
    console.log('2. deliveryInfoData 배열 길이:', deliveryInfoData.length);
    console.log('3. orders1688Data 배열 길이:', orders1688Data.length);

    // 1단계: 배송번호로 deliveryInfoData에서 order_id 찾기
    const matchingDeliveryInfos = deliveryInfoData.filter((info: any) =>
      info.delivery_code?.toLowerCase().includes(deliveryCode.toLowerCase())
    );

    if (matchingDeliveryInfos.length === 0) {
      console.log('4. ❌ deliveryInfoData에서 매칭 실패');
      return [];
    }

    console.log(`4. ✅ deliveryInfo ${matchingDeliveryInfos.length}개 찾음`);

    // order_id 추출
    const orderIds = matchingDeliveryInfos
      .map((info: any) => info.order_id)
      .filter((id: any) => id);

    console.log('5. 추출된 order_id들:', orderIds);

    if (orderIds.length === 0) {
      console.log('6. ❌ order_id가 없음');
      return [];
    }

    // 2단계: order_id로 orders1688Data에서 1688_order_id 매칭하여 order_number 찾기
    const matchingOrders = orders1688Data.filter((order: Order1688Data) =>
      orderIds.includes(order['1688_order_id'])
    );

    console.log(`6. ✅ 1688_order_id 매칭된 주문: ${matchingOrders.length}개`);

    if (matchingOrders.length === 0) {
      console.log('7. ❌ 1688_order_id 매칭 실패');
      return [];
    }

    // order_number 추출 및 정규화
    const orderNumbers = matchingOrders.map((order: Order1688Data) =>
      truncateOrderNumber(order.order_number)
    );

    console.log('7. 추출된 order_number들 (정규화):', orderNumbers);

    return orderNumbers;
  };

  // 배송번호로 메모리에서 배송정보 조회 (모든 매칭 항목 반환)
  const searchDeliveryInfo = (deliveryCode: string) => {
    console.log('=== searchDeliveryInfo 시작 ===');
    console.log('1. 검색할 배송번호:', deliveryCode);
    console.log('2. deliveryInfoData 배열 길이:', deliveryInfoData.length);

    // 배송번호로 모든 매칭 항목 찾기
    const matchingInfos = deliveryInfoData.filter((info: any) =>
      info.delivery_code?.toLowerCase().includes(deliveryCode.toLowerCase())
    );

    console.log(`3. 매칭된 배송정보 개수: ${matchingInfos.length}`);

    if (matchingInfos.length > 0) {
      console.log('4. ✅ 배송정보 찾음!');
      matchingInfos.forEach((info: any, idx: number) => {
        console.log(`   [${idx + 1}] sheet_order_number: ${info.sheet_order_number}`);
      });
      return matchingInfos;
    } else {
      console.log('4. ❌ 매칭 실패');
      console.log('=== searchDeliveryInfo 종료 (결과 없음) ===');
      return [];
    }
  };

  // order_info 파싱 및 검색 함수
  const parseOrderInfoAndSearch = (orderInfo: string) => {
    console.log('=== parseOrderInfoAndSearch 시작 ===');
    console.log('1. order_info 원본:', orderInfo);
    console.log('2. 현재 itemData 개수:', itemData.length);

    const lines = orderInfo.split('\n').filter(line => line.trim());
    console.log('3. 파싱할 라인 개수:', lines.length);

    const searchResults: ItemData[] = [];
    let lineIndex = 0;

    lines.forEach(line => {
      lineIndex++;
      console.log(`\n--- 라인 ${lineIndex} 처리 시작 ---`);
      console.log(`라인 내용: "${line}"`);

      let matchingItems: ItemData[] = [];

      // 패턴 1: 새로운 형식 - 글번호 // 옵션1 | 옵션2 // 바코드 // 개수ea
      console.log('4. 새 형식 정규식 매칭 시도...');
      const newFormatMatch = line.match(/^(.+?)\s*\/\/\s*(.+?)\s*\|\s*(.+?)\s*\/\/\s*(\S+)\s*\/\/\s*(\d+)ea$/);

      if (newFormatMatch) {
        console.log('5. ✅ 새 형식 매칭 성공!');
        const [fullMatch, orderNumber, option1, option2, barcode, quantity] = newFormatMatch;

        console.log('6. 파싱 결과:', {
          전체매칭: fullMatch,
          글번호: orderNumber,
          옵션1: option1,
          옵션2: option2,
          바코드: barcode,
          수량: quantity
        });

        console.log('7. itemData에서 매칭 검색 시작...');
        console.log(`   검색 조건: order_number="${orderNumber.trim()}" AND barcode="${barcode.trim()}"`);

        let matchCount = 0;
        matchingItems = itemData.filter((item, index) => {
          const itemOrderNumber = (item.order_number || '').toString().trim();
          const itemBarcode = (item.barcode || '').toString().trim();

          const orderMatch = itemOrderNumber === orderNumber.trim();
          const barcodeMatch = itemBarcode === barcode.trim();

          // 처음 3개 비교만 상세 로그
          if (index < 3) {
            console.log(`   [${index}] 시트: order="${itemOrderNumber}", barcode="${itemBarcode}"`);
            console.log(`       → order일치=${orderMatch}, barcode일치=${barcodeMatch}`);
          }

          if (orderMatch && barcodeMatch) {
            matchCount++;
            console.log(`   ✅ 매칭 발견! [${matchCount}] order_number="${itemOrderNumber}", barcode="${itemBarcode}"`);
          }

          return orderMatch && barcodeMatch;
        });

        console.log(`8. 새 형식 검색 결과: ${matchingItems.length}개 매칭`);
        searchResults.push(...matchingItems);
      } else {
        console.log('5. ❌ 새 형식 매칭 실패');
        console.log('6. 기존 형식 정규식 매칭 시도...');

        // 패턴 2: 기존 형식 - MMDD - 옵션1 | 옵션2 - 바코드 - 개수?
        const oldFormatMatch = line.match(/^(\d{4})\s*-\s*(.+?)\s*\|\s*(.+?)\s*-\s*(\S+)\s*-\s*(\d+)\?$/);

        if (oldFormatMatch) {
          console.log('7. ✅ 기존 형식 매칭 성공!');
          const [, dateMMDD, option1, option2, barcode, quantity] = oldFormatMatch;

          console.log('8. 파싱 결과:', {
            날짜: dateMMDD,
            옵션1: option1,
            옵션2: option2,
            바코드: barcode,
            수량: quantity
          });

          matchingItems = itemData.filter(item => {
            const orderPrefix = (item.order_number_prefix || '').toString();
            const itemDate = orderPrefix.slice(-4);
            const itemBarcode = (item.barcode || '').toString();

            return itemDate === dateMMDD && itemBarcode === barcode;
          });

          console.log(`9. 기존 형식 검색 결과: ${matchingItems.length}개`);
          searchResults.push(...matchingItems);
        } else {
          console.log('7. ❌ 기존 형식 매칭도 실패');
          console.log('   → 이 라인은 알 수 없는 형식입니다.');
        }
      }

      console.log(`--- 라인 ${lineIndex} 처리 종료 ---\n`);
    });

    console.log('=== parseOrderInfoAndSearch 종료 ===');
    console.log(`최종 검색 결과: 총 ${searchResults.length}개 항목 발견`);
    return searchResults;
  };

  // 검색 함수
  const performSearch = async (
    activeStatus: string,
    sortType: string,
    sortData: (data: ItemData[], sortType: string) => ItemData[],
    filterByStatus: (data: ItemData[], status: string) => ItemData[],
    setLoading: (loading: boolean) => void,
    setFilteredData: (data: ItemData[]) => void,
    setCurrentPage: (page: number) => void
  ) => {
    console.log('\n\n========================================');
    console.log('🔍 performSearch 시작');
    console.log('========================================');
    console.log('검색어:', searchTerm);
    console.log('검색 타입:', searchType);
    console.log('활성 상태:', activeStatus);

    if (!searchTerm.trim()) {
      console.log('❌ 검색어가 비어있음 - 전체 데이터 표시');
      const filteredByStatus = filterByStatus(itemData, activeStatus);
      const sortedData = sortData(filteredByStatus, sortType);
      setFilteredData(sortedData);
      setCurrentPage(1);
      return;
    }

    try {
      setLoading(true);
      console.log('⏳ 로딩 시작...');

      let searchResults: ItemData[] = [];

      if (searchType === '배송번호') {
        console.log('\n📦 배송번호 검색 모드');
        console.log('1단계: searchDeliveryInfo 호출 (기존 방식)');

        const deliveryInfos = searchDeliveryInfo(searchTerm);

        console.log('\n2단계: deliveryInfos 결과 확인');
        if (deliveryInfos.length > 0) {
          console.log(`✅ deliveryInfo ${deliveryInfos.length}개 찾음`);

          // 모든 sheet_order_number 추출 및 정규화
          const sheetOrderNumbers = deliveryInfos.map((info: any) =>
            truncateOrderNumber(info.sheet_order_number)
          );
          console.log('\n3단계: sheet_order_number로 itemData 검색 (정규화 적용)');
          console.log('검색할 주문번호들:', sheetOrderNumbers);

          // itemData에서 매칭 (양쪽 모두 정규화해서 비교)
          searchResults = itemData.filter(item =>
            sheetOrderNumbers.includes(truncateOrderNumber(item.order_number || ''))
          );

          console.log(`✅ 배송번호 검색 완료 (기존 방식): ${searchResults.length}개 발견`);
        }

        // 기존 방식으로 결과가 없으면 1688_order_id 방식으로 시도
        if (searchResults.length === 0) {
          console.log('\n📦 1688_order_id 매칭 방식 시도');
          const orderNumbersFrom1688 = searchBy1688OrderId(searchTerm);

          if (orderNumbersFrom1688.length > 0) {
            console.log('검색할 주문번호들 (1688):', orderNumbersFrom1688);

            // itemData에서 매칭 (양쪽 모두 정규화해서 비교)
            searchResults = itemData.filter(item =>
              orderNumbersFrom1688.includes(truncateOrderNumber(item.order_number || ''))
            );

            console.log(`✅ 배송번호 검색 완료 (1688 방식): ${searchResults.length}개 발견`);
          } else {
            console.log('❌ 1688_order_id 방식으로도 찾을 수 없음');
            searchResults = [];
          }
        }
      } else if (searchType === '일반검색') {
        console.log('\n🔎 일반검색 모드');
        searchResults = itemData.filter(item => {
          const productName = (item.product_name || '').toString();
          const productNameSub = (item.product_name_sub || '').toString();
          const barcode = (item.barcode || '').toString();
          const chinaOption1 = (item.china_option1 || '').toString();
          const chinaOption2 = (item.china_option2 || '').toString();
          const orderNumber = (item.order_number || '').toString();

          return productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 productNameSub.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 chinaOption1.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 chinaOption2.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
        });
        console.log(`✅ 일반검색 완료: ${searchResults.length}개 발견`);
      }

      console.log('\n5단계: 상태 필터링 및 정렬');
      const filteredByStatus = filterByStatus(searchResults, activeStatus);
      console.log(`필터링 후: ${filteredByStatus.length}개`);

      const sortedData = sortData(filteredByStatus, sortType);
      console.log(`정렬 완료: ${sortedData.length}개`);

      setFilteredData(sortedData);

      console.log('\n========================================');
      console.log(`✅ 검색 완료: "${searchTerm}" - ${filteredByStatus.length}개 결과`);
      console.log('========================================\n\n');

    } catch (error) {
      console.error('❌ 검색 오류:', error);
      alert('검색 중 오류가 발생했습니다.');
      setFilteredData([]);
    } finally {
      setLoading(false);
      setCurrentPage(1);
      console.log('⏹️ 로딩 종료\n');
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
