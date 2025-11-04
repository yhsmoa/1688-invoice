import { useState } from 'react';
import { ItemData } from './useItemData';

export const useSearch = (
  itemData: ItemData[],
  deliveryInfoData: {[key: string]: any}
) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState<string>('배송번호');

  // 배송번호로 메모리에서 배송정보 조회
  const searchDeliveryInfo = (deliveryCode: string) => {
    console.log('=== searchDeliveryInfo 시작 ===');
    console.log('1. 검색할 배송번호:', deliveryCode);
    console.log('2. deliveryInfoData 타입:', typeof deliveryInfoData);
    console.log('3. deliveryInfoData 키 개수:', Object.keys(deliveryInfoData).length);

    // 처음 10개 키 출력
    const keys = Object.keys(deliveryInfoData).slice(0, 10);
    console.log('4. deliveryInfoData 샘플 키:', keys);

    // 정확한 매칭 시도
    console.log('5. 정확한 매칭 시도: deliveryInfoData["' + deliveryCode + '"]');
    const deliveryInfo = deliveryInfoData[deliveryCode];

    if (deliveryInfo) {
      console.log('6. ✅ 배송정보 찾음!');
      console.log('7. 배송정보 내용:', {
        delivery_code: deliveryInfo.delivery_code,
        order_id: deliveryInfo.order_id,
        delivery_status: deliveryInfo.delivery_status,
        order_info: deliveryInfo.order_info?.substring(0, 100) + '...'
      });
      return deliveryInfo;
    } else {
      console.log('6. ❌ 정확한 매칭 실패');
      console.log('7. 부분 일치 검색 시도...');

      // 부분 일치 검색 시도
      const partialMatch = Object.keys(deliveryInfoData).find(key => {
        const match = key.includes(deliveryCode) || deliveryCode.includes(key);
        if (match) {
          console.log(`   부분 일치 발견: "${key}" <-> "${deliveryCode}"`);
        }
        return match;
      });

      if (partialMatch) {
        console.log('8. ✅ 부분 일치 발견:', partialMatch);
        return deliveryInfoData[partialMatch];
      }

      console.log('8. ❌ 부분 일치도 실패');
      console.log('=== searchDeliveryInfo 종료 (결과 없음) ===');
      return null;
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
        console.log('1단계: searchDeliveryInfo 호출');

        const deliveryInfo = searchDeliveryInfo(searchTerm);

        console.log('\n2단계: deliveryInfo 결과 확인');
        if (deliveryInfo) {
          console.log('✅ deliveryInfo 찾음:', {
            delivery_code: deliveryInfo.delivery_code,
            order_id: deliveryInfo.order_id,
            has_order_info: !!deliveryInfo.order_info
          });

          if (deliveryInfo.order_info) {
            console.log('\n3단계: parseOrderInfoAndSearch 호출');
            searchResults = parseOrderInfoAndSearch(deliveryInfo.order_info);

            console.log('\n4단계: 배송정보 추가');
            searchResults = searchResults.map(item => ({
              ...item,
              order_id: deliveryInfo.order_id || null,
              delivery_status: deliveryInfo.delivery_status || null
            }));

            console.log(`✅ 배송번호 검색 완료: ${searchResults.length}개 발견`);
          } else {
            console.log('❌ order_info가 비어있음');
            searchResults = [];
          }
        } else {
          console.log('❌ deliveryInfo를 찾을 수 없음');
          searchResults = [];
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
    parseOrderInfoAndSearch
  };
};
