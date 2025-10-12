'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import SearchForm from '../../component/SearchForm';
import StatusCard from './StatusCard';
import './ItemCheck.css';

// 디바운스 함수 구현
const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<F>): Promise<ReturnType<F>> => {
    if (timeout) {
      clearTimeout(timeout);
    }

    return new Promise(resolve => {
      timeout = setTimeout(() => {
        resolve(func(...args));
      }, waitFor);
    });
  };
};

interface ItemData {
  id: string;
  row_number?: string; // 구글 시트 행 번호
  img_url?: string; // 이미지 URL
  site_url?: string; // 사이트 URL (L열)
  order_number_prefix?: string; // 글번호 앞부분 (A열)
  order_number: string; // 글번호 뒷부분 (B열)
  product_name: string | null; // 상품명 첫 줄 (C열)
  product_name_sub?: string | null; // 상품명 둘째 줄 (D열)
  barcode?: string | null; // 바코드 (F열)
  china_option1?: string | null; // 주문옵션 첫 줄 (G열)
  china_option2?: string | null; // 주문옵션 둘째 줄 (H열)
  order_qty: number | null; // 개수 (E열)
  cost_main?: string | null; // 비용 첫 줄 (I열)
  cost_sub?: string | null; // 비용 둘째 줄 (J열)
  progress_qty?: number | null; // 진행 (M열)
  import_qty?: number | null; // 입고 (N열)
  cancel_qty?: number | null; // 취소 (O열)
  export_qty?: number | null; // 출고 (P열)
  note?: string | null; // 비고 (R열)
  option_id?: string | null; // 옵션 ID (U열)
  product_size?: string | null; // 상품 입고 사이즈 (V열)
  order_id?: string | null; // 주문 ID (배송정보)
  delivery_status?: string | null; // 배송 상태 (배송정보)
  // 기존 필드들 (호환성을 위해 남겨둠)
  date?: string;
  row_id?: string;
  confirm_qty?: number | null;
}

const ItemCheck: React.FC = () => {
  const { t } = useTranslation();
  const cardData = [
    t('importProduct.statusCards.all'),
    t('importProduct.statusCards.beforeShipment'),
    t('importProduct.statusCards.partialReceived'),
    t('importProduct.statusCards.receivedComplete'),
    t('importProduct.statusCards.defective'),
    t('importProduct.statusCards.return')
  ];
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<ItemData[]>([]);
  const [originalData, setOriginalData] = useState<ItemData[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>(t('importProduct.statusCards.all'));
  const [searchType, setSearchType] = useState<string>(t('importProduct.searchType.deliveryNumber'));
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{[key: string]: string}>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [productQuantities, setProductQuantities] = useState<{ [key: string]: number }>({});
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string}[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');
  const [isLoadingFromCache, setIsLoadingFromCache] = useState(false);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [paginatedData, setPaginatedData] = useState<ItemData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  
  // 셀 편집 상태
  const [editingCell, setEditingCell] = useState<{id: string, field: string} | null>(null);
  const [cellValue, setCellValue] = useState<string>('');
  
  // 수정된 데이터 추적
  const [modifiedData, setModifiedData] = useState<{[key: string]: {[field: string]: number | string | null}}>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // 정렬 상태
  const [sortType, setSortType] = useState<string>('주문순서');

  // 엑셀 업로드 관련 상태
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);

  // 배송정보 상태 (초기 로딩용)
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

    // 나머지 상태는 아직 구현되지 않음
    return counts;
  }, [itemData]);

  // 정렬 함수
  const sortData = (data: ItemData[], sortType: string): ItemData[] => {
    const sortedData = [...data];
    
    if (sortType === '주문순서') {
      // row_number 오름차순으로 정렬
      return sortedData.sort((a, b) => {
        const aRowNumber = parseInt(a.row_number || '0');
        const bRowNumber = parseInt(b.row_number || '0');
        return aRowNumber - bRowNumber;
      });
    } else if (sortType === '품목별') {
      // 1. product_name 2. china_option1 3. row_number 순서로 정렬
      return sortedData.sort((a, b) => {
        // 1차: product_name 비교
        const aProductName = a.product_name || '';
        const bProductName = b.product_name || '';
        const productCompare = aProductName.localeCompare(bProductName);
        
        if (productCompare !== 0) {
          return productCompare;
        }
        
        // 2차: china_option1 비교
        const aOption = a.china_option1 || '';
        const bOption = b.china_option1 || '';
        const optionCompare = aOption.localeCompare(bOption);
        
        if (optionCompare !== 0) {
          return optionCompare;
        }
        
        // 3차: row_number 비교
        const aRowNumber = parseInt(a.row_number || '0');
        const bRowNumber = parseInt(b.row_number || '0');
        return aRowNumber - bRowNumber;
      });
    }
    
    return sortedData;
  };

  // 정렬 타입 변경 핸들러
  const handleSortTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSortType = e.target.value;
    setSortType(newSortType);
    
    // 현재 필터링된 데이터를 새로운 정렬 기준으로 정렬
    const sortedData = sortData(filteredData, newSortType);
    setFilteredData(sortedData);
    setCurrentPage(1); // 정렬 시 첫 페이지로 이동
  };

  // 메모 저장 함수
  const saveNote = async (orderNumber: string, note: string) => {
    if (savingNote === orderNumber) return;
    
    try {
      setSavingNote(orderNumber);
      
      // 메모 저장 API 호출
      const response = await fetch('/api/save-item-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          order_number: orderNumber,
          note: note
        }),
      });

      if (response.ok) {
        // 로컬 상태 업데이트
        setNoteText(prev => ({
          ...prev,
          [orderNumber]: note
        }));
        
        // 필터링된 데이터 업데이트
        setFilteredData(prev => 
          prev.map(item => 
            item.order_number === orderNumber ? { ...item, note } : item
          )
        );
        
        // 전체 데이터 업데이트
        setItemData(prev => 
          prev.map(item => 
            item.order_number === orderNumber ? { ...item, note } : item
          )
        );
        
        setEditingNote(null);
      } else {
        const errorData = await response.json();
        console.error('메모 저장 실패:', errorData);
        alert('메모 저장 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('메모 저장 오류:', error);
      alert('메모 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingNote(null);
    }
  };
  
  // 디바운스된 저장 함수
  const debouncedSaveNote = debounce(saveNote, 500);
  
  // 메모 편집 시작
  const startEditingNote = (orderNumber: string) => {
    setEditingNote(orderNumber);
    // 기존 메모가 있으면 가져오고, 없으면 빈 문자열로 설정
    const currentNote = noteText[orderNumber] || '';
    setNoteText(prev => ({
      ...prev,
      [orderNumber]: currentNote
    }));
  };
  
  // 메모 텍스트 변경 처리
  const handleNoteChange = (orderNumber: string, value: string) => {
    setNoteText(prev => ({
      ...prev,
      [orderNumber]: value
    }));
  };

  // 셀 편집 시작
  const startEditingCell = (id: string, field: string, value: number | string | null | undefined) => {
    setEditingCell({ id, field });
    if (field === 'note') {
      setCellValue(value ? value.toString() : '');
    } else {
      setCellValue(value !== null && value !== undefined ? value.toString() : '');
    }
  };

  // 다음 편집 가능한 셀로 이동
  const moveToNextEditableCell = (currentId: string, currentField: string) => {
    const editableFields = ['import_qty', 'cancel_qty', 'note'];
    const currentFieldIndex = editableFields.indexOf(currentField);

    if (currentField === 'import_qty') {
      // 입고 열에서는 다음 행의 입고 열로 이동
      const currentIndex = paginatedData.findIndex(item => item.id === currentId);
      if (currentIndex >= 0 && currentIndex < paginatedData.length - 1) {
        const nextItem = paginatedData[currentIndex + 1];
        startEditingCell(nextItem.id, 'import_qty', nextItem.import_qty);
      }
    } else {
      // 취소, 비고 열에서는 같은 행의 다음 필드로 이동
      if (currentFieldIndex < editableFields.length - 1) {
        const nextField = editableFields[currentFieldIndex + 1];
        const currentItem = paginatedData.find(item => item.id === currentId);
        if (currentItem) {
          startEditingCell(currentId, nextField, currentItem[nextField as keyof ItemData]);
        }
      }
    }
  };

  // 셀 편집 완료
  const finishEditingCell = async (moveToNext: boolean = false) => {
    if (editingCell) {
      const { id, field } = editingCell;

      // note 필드인 경우 문자열 값, 그 외는 숫자 값
      const finalValue = field === 'note'
        ? (cellValue === '' ? null : cellValue)
        : (cellValue === '' ? null : Number(cellValue));

      // 현재 아이템 찾기
      const currentItem = filteredData.find(item => item.id === id);
      if (!currentItem) {
        setEditingCell(null);
        return;
      }


      const currentValue = currentItem[field as keyof ItemData];

      // 값이 실제로 변경된 경우에만 처리
      const valueChanged = finalValue !== currentValue;

      if (valueChanged) {
        // 데이터 업데이트
        const updatedData = filteredData.map(item =>
          item.id === id ? { ...item, [field]: finalValue } : item
        );

        setFilteredData(updatedData);

        // 전체 데이터도 업데이트
        const updatedItemData = itemData.map(item =>
          item.id === id ? { ...item, [field]: finalValue } : item
        );

        setItemData(updatedItemData);

        // 변경된 항목 찾기
        const updatedItem = updatedData.find(item => item.id === id);

        // 수정된 데이터 추적 - row_number를 row_id로 사용
        if (updatedItem && updatedItem.row_number) {
          const rowKey = updatedItem.row_number; // row_number가 구글시트의 실제 행 번호
          setModifiedData(prev => ({
            ...prev,
            [rowKey]: {
              ...(prev[rowKey] || {}),
              [field]: finalValue
            }
          }));
        }
      }

      const currentId = id;
      const currentField = field;
      setEditingCell(null);

      // Enter로 완료된 경우 다음 셀로 이동
      if (moveToNext) {
        setTimeout(() => {
          moveToNextEditableCell(currentId, currentField);
        }, 50);
      }
    }
  };

  // 셀 값 변경
  const handleCellValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // 숫자만 입력 가능하도록
    const value = e.target.value.replace(/[^0-9]/g, '');
    setCellValue(value);
  };

  // 셀 키 이벤트 처리
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingCell(true); // Enter 시 다음 셀로 이동
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finishEditingCell(); // Tab 시 현재 위치에서 완료
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  // 데이터 가져오기 - 초기에는 빈 데이터
  const fetchItemData = async () => {
    console.log('fetchItemData 시작');
    // 초기 로드 시에는 빈 데이터만 설정
    setOriginalData([]);
    setItemData([]);
    setFilteredData([]);
    setLoading(false);
  };

  useEffect(() => {
    fetchItemData();
    fetchCoupangUsers();
    fetchAllDeliveryInfo();
  }, []);

  // 배송정보 매핑 함수
  const mapDeliveryInfoToItems = (items: ItemData[]): ItemData[] => {
    console.log('=== 배송정보 매핑 시작 ===');
    console.log('총 아이템 개수:', items.length);
    console.log('배송정보 개수:', Object.keys(deliveryInfoData).length);

    let matchedCount = 0;
    let unmatchedCount = 0;

    const result = items.map((item, index) => {
      // 각 아이템의 바코드로 배송정보 찾기
      const itemBarcode = item.barcode?.toString().trim();

      if (!itemBarcode) {
        unmatchedCount++;
        return item;
      }

      // deliveryInfoData에서 해당 바코드를 포함하는 배송정보 찾기
      let matchedDeliveryInfo = null;

      for (const [deliveryCode, deliveryInfo] of Object.entries(deliveryInfoData)) {
        if (deliveryInfo.order_info) {
          // order_info에서 현재 아이템의 바코드가 포함되어 있는지 확인
          const orderInfoLines = deliveryInfo.order_info.split('\n').filter((line: string) => line.trim());

          for (const line of orderInfoLines) {
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

      // 매칭된 배송정보가 있으면 추가
      if (matchedDeliveryInfo) {
        matchedCount++;
        if (matchedCount <= 5) {
          console.log(`매칭 성공 [${matchedCount}]:`, {
            barcode: itemBarcode,
            order_id: matchedDeliveryInfo.order_id,
            delivery_status: matchedDeliveryInfo.delivery_status
          });
        }
        return {
          ...item,
          order_id: matchedDeliveryInfo.order_id || null,
          delivery_status: matchedDeliveryInfo.delivery_status || null
        };
      } else {
        unmatchedCount++;
        if (unmatchedCount <= 3) {
          console.log(`매칭 실패 [${unmatchedCount}]: 바코드=${itemBarcode}`);
        }
      }

      return item;
    });

    console.log('=== 배송정보 매핑 완료 ===');
    console.log('매칭 성공:', matchedCount);
    console.log('매칭 실패:', unmatchedCount);

    return result;
  };

  // 드롭다운 선택 시 캐시된 데이터 로드
  useEffect(() => {
    if (selectedCoupangUser && !isLoadingFromCache) {
      loadCachedData(selectedCoupangUser);
    }
  }, [selectedCoupangUser]);

  // 캐시된 데이터 로드 함수
  const loadCachedData = (coupangName: string) => {
    try {
      const cacheKey = `sheet_data_${coupangName}`;
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        const parsedData = JSON.parse(cachedData);

        // 배송정보 매핑 적용
        const dataWithDeliveryInfo = mapDeliveryInfoToItems(parsedData.data || []);

        // 현재 활성화된 상태에 따라 필터링
        const filteredByStatus = filterByStatus(dataWithDeliveryInfo, activeStatus);

        const sortedData = sortData(filteredByStatus, sortType);
        setOriginalData(dataWithDeliveryInfo);
        setItemData(dataWithDeliveryInfo);
        setFilteredData(sortedData);

        // 캐시된 데이터 표시 메시지 (선택적)
        console.log(`${coupangName}의 캐시된 데이터를 불러왔습니다.`);
      }
    } catch (error) {
      console.error('캐시 데이터 로드 오류:', error);
    }
  };

  // 데이터를 localStorage에 저장하는 함수
  const saveToCache = (coupangName: string, data: ItemData[], googlesheetId?: string, userId?: string) => {
    try {
      const cacheKey = `sheet_data_${coupangName}`;
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        coupangName: coupangName,
        googlesheet_id: googlesheetId,
        user_id: userId
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (error) {
      console.error('캐시 저장 오류:', error);
      // localStorage가 가듵 차면 오래된 캐시 삭제
      try {
        const keys = Object.keys(localStorage);
        const sheetDataKeys = keys.filter(key => key.startsWith('sheet_data_'));
        if (sheetDataKeys.length > 0) {
          // 가장 오래된 캐시 삭제
          localStorage.removeItem(sheetDataKeys[0]);
          // 다시 시도
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        }
      } catch (e) {
        console.error('캐시 정리 실패:', e);
      }
    }
  };

  // 쿠팡 사용자 목록 가져오기
  const fetchCoupangUsers = async () => {
    try {
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      if (result.success && result.data) {
        setCoupangUsers(result.data);
      }
    } catch (error) {
      console.error('쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  // 모든 배송정보 초기 로딩
  const fetchAllDeliveryInfo = async () => {
    try {
      console.log('배송정보 전체 로딩 시작...');

      const response = await fetch('/api/get-all-delivery-info');
      const result = await response.json();

      if (result.success && result.data) {
        // delivery_code를 키로 하는 맵으로 변환
        const deliveryMap: {[key: string]: any} = {};
        result.data.forEach((item: any) => {
          if (item.delivery_code) {
            deliveryMap[item.delivery_code] = item;
          }
        });

        setDeliveryInfoData(deliveryMap);
        console.log(`배송정보 ${result.data.length}개 로딩 완료`);
      } else {
        console.log('배송정보 로딩 실패 또는 데이터 없음');
      }
    } catch (error) {
      console.error('배송정보 로딩 오류:', error);
    }
  };

  // 페이지네이션 처리 함수
  const updatePaginatedData = (data: ItemData[]) => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedData(data.slice(startIndex, endIndex));
    setTotalPages(Math.ceil(data.length / itemsPerPage));
  };

  // 페이지 변경 함수
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // 다음 페이지로 이동
  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // 이전 페이지로 이동
  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // 필터링된 데이터가 변경될 때 페이지네이션 업데이트
  useEffect(() => {
    updatePaginatedData(filteredData);
  }, [filteredData, currentPage]);

  // 배송번호로 메모리에서 배송정보 조회
  const searchDeliveryInfo = (deliveryCode: string) => {
    console.log('배송번호로 메모리에서 조회:', deliveryCode);

    const deliveryInfo = deliveryInfoData[deliveryCode];
    if (deliveryInfo) {
      console.log('배송정보 찾음:', deliveryInfo);
      return deliveryInfo;
    } else {
      console.log('배송정보를 찾을 수 없음');
      return null;
    }
  };

  // order_info 파싱 및 검색 함수
  const parseOrderInfoAndSearch = (orderInfo: string) => {
    console.log('order_info 파싱:', orderInfo);

    // 줄바꿈으로 나누어 각 라인 처리
    const lines = orderInfo.split('\n').filter(line => line.trim());
    const searchResults: ItemData[] = [];

    lines.forEach(line => {
      let matchingItems: ItemData[] = [];

      // 패턴 1: 새로운 형식 - 글번호 // 옵션1 | 옵션2 // 바코드 // 개수ea
      const newFormatMatch = line.match(/^([^//]+)\s*\/\/\s*(.+?)\s*\|\s*(.+?)\s*\/\/\s*(\S+)\s*\/\/\s*(\d+)ea$/);

      if (newFormatMatch) {
        const [, orderNumber, option1, option2, barcode, quantity] = newFormatMatch;

        console.log(`새 형식 파싱 - 글번호: ${orderNumber}, 옵션1: ${option1}, 옵션2: ${option2}, 바코드: ${barcode}, 수량: ${quantity}`);

        // 글번호(order_number)로 검색
        matchingItems = itemData.filter(item => {
          const itemOrderNumber = (item.order_number || '').toString();
          const itemBarcode = (item.barcode || '').toString();

          return itemOrderNumber === orderNumber.trim() && itemBarcode === barcode;
        });

        searchResults.push(...matchingItems);
      } else {
        // 패턴 2: 기존 형식 - MMDD - 옵션1 | 옵션2 - 바코드 - 개수?
        const oldFormatMatch = line.match(/^(\d{4})\s*-\s*(.+?)\s*\|\s*(.+?)\s*-\s*(\S+)\s*-\s*(\d+)\?$/);

        if (oldFormatMatch) {
          const [, dateMMDD, option1, option2, barcode, quantity] = oldFormatMatch;

          console.log(`기존 형식 파싱 - 날짜: ${dateMMDD}, 옵션1: ${option1}, 옵션2: ${option2}, 바코드: ${barcode}, 수량: ${quantity}`);

          // 현재 메모리 데이터에서 해당 날짜와 바코드로 검색
          matchingItems = itemData.filter(item => {
            // order_number_prefix에서 날짜 추출 (MMDD 형태)
            const orderPrefix = (item.order_number_prefix || '').toString();
            const itemDate = orderPrefix.slice(-4); // 마지막 4자리가 MMDD

            // 바코드 매칭
            const itemBarcode = (item.barcode || '').toString();

            return itemDate === dateMMDD && itemBarcode === barcode;
          });

          searchResults.push(...matchingItems);
        }
      }
    });

    return searchResults;
  };

  // 상태별 필터링 함수
  const filterByStatus = (data: ItemData[], status: string): ItemData[] => {
    console.log('filterByStatus 호출 - 상태:', status, '전체 데이터:', data.length);

    if (status === '전체') {
      return data;
    } else if (status === '발송전') {
      const filtered = data.filter(item => {
        const deliveryStatus = item.delivery_status;
        const isMatch = deliveryStatus === '等待卖家发货' || !deliveryStatus || deliveryStatus.trim() === '';

        // 매칭된 항목 로그 제거 (성능 개선)

        return isMatch;
      });

      console.log('발송전 필터링 결과:', filtered.length, '개');
      return filtered;
    }
    // 나머지 상태는 아직 구현하지 않음
    return data;
  };

  // 검색 함수 - 메모리 기반 검색으로 변경
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      const filteredByStatus = filterByStatus(itemData, activeStatus);
      const sortedData = sortData(filteredByStatus, sortType);
      setFilteredData(sortedData); // 검색어가 없으면 상태 필터링된 데이터 표시 (정렬 적용)
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
      return;
    }

    try {
      setLoading(true);

      let searchResults: ItemData[] = [];

      if (searchType === '배송번호') {
        // 배송번호 검색: 메모리에서 배송정보 조회
        const deliveryInfo = searchDeliveryInfo(searchTerm);

        if (deliveryInfo && deliveryInfo.order_info) {
          // order_info를 파싱하여 날짜와 바코드로 메모리 데이터 검색
          searchResults = parseOrderInfoAndSearch(deliveryInfo.order_info);

          // 검색 결과에 배송정보 추가 (order_id, delivery_status)
          searchResults = searchResults.map(item => ({
            ...item,
            order_id: deliveryInfo.order_id || null,
            delivery_status: deliveryInfo.delivery_status || null
          }));

          console.log(`배송번호 검색 결과: ${searchResults.length}개`);
        } else {
          console.log('배송정보를 찾을 수 없습니다.');
          searchResults = [];
        }
      } else if (searchType === '일반검색') {
        // 일반검색: 상품명, 바코드에서 검색
        searchResults = itemData.filter(item => {
          const productName = (item.product_name || '').toString();
          const productNameSub = (item.product_name_sub || '').toString();
          const barcode = (item.barcode || '').toString();
          const chinaOption1 = (item.china_option1 || '').toString();
          const chinaOption2 = (item.china_option2 || '').toString();

          return productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 productNameSub.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 chinaOption1.toLowerCase().includes(searchTerm.toLowerCase()) ||
                 chinaOption2.toLowerCase().includes(searchTerm.toLowerCase());
        });
      }

      // 검색 결과에도 상태 필터링 적용
      const filteredByStatus = filterByStatus(searchResults, activeStatus);
      const sortedData = sortData(filteredByStatus, sortType);
      setFilteredData(sortedData);

      console.log(`검색 완료: "${searchTerm}" - ${filteredByStatus.length}개 결과`);

    } catch (error) {
      console.error('검색 오류:', error);
      alert('검색 중 오류가 발생했습니다.');
      setFilteredData([]);
    } finally {
      setLoading(false);
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
    }
  };

  // 검색어 변경 시 자동으로 필터링하지 않음 (메모리 효율성을 위해)
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // 검색 타입 변경 시 검색어 초기화 및 전체 데이터 표시
  const handleSearchTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchType(e.target.value);
    setSearchTerm(''); // 검색어 초기화
    const filteredByStatus = filterByStatus(itemData, activeStatus);
    const sortedData = sortData(filteredByStatus, sortType);
    setFilteredData(sortedData); // 상태 필터링된 데이터 표시 (정렬 적용)
    setCurrentPage(1);
  };

  // 상태 카드 클릭 핸들러
  const handleStatusCardClick = (status: string) => {
    console.log('카드 클릭:', status);
    console.log('이전 activeStatus:', activeStatus);
    console.log('현재 itemData 개수:', itemData.length);

    setActiveStatus(status);
    console.log('activeStatus 변경 시도:', status);

    setSearchTerm(''); // 검색어 초기화

    const filteredByStatus = filterByStatus(itemData, status);
    console.log('필터링된 데이터 개수:', filteredByStatus.length);

    const sortedData = sortData(filteredByStatus, sortType);
    setFilteredData(sortedData);
    setCurrentPage(1);
  };

  // 검색 버튼 클릭
  const handleSearchClick = () => {
    performSearch();
  };

  // Enter 키 검색
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  // 체크박스 관련 함수들
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(filteredData.map(item => item.id));
      setSelectedRows(allIds);
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSelectRow = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedRows(newSelected);
  };

  const isAllSelected = filteredData.length > 0 && selectedRows.size === filteredData.length;
  const isIndeterminate = selectedRows.size > 0 && selectedRows.size < filteredData.length;

  const handleLoadGoogleSheet = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.googlesheet_id) {
      alert('선택한 사용자의 구글 시트 ID를 찾을 수 없습니다.');
      return;
    }

    try {
      setLoading(true);
      setIsLoadingFromCache(true); // 캐시 로드 방지 플래그 설정
      
      // 최적화된 API 엔드포인트 사용 - 캐시 비활성화, 사용자 이름 추가
      const response = await fetch(`/api/load-google-sheet-optimized?googlesheet_id=${selectedUser.googlesheet_id}&coupang_name=${encodeURIComponent(selectedCoupangUser)}&cache=false`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      let result;
      try {
        result = await response.json();
        console.log('구글 시트 API 응답:', result);
      } catch (parseError: any) {
        const errorText = await response.text();
        console.error('응답 파싱 오류:', parseError);
        console.error('원본 응답 텍스트:', errorText);
        throw new Error('API 응답을 파싱할 수 없습니다.');
      }
      
      if (response.ok && result.success) {
        // 배송정보 매핑 적용
        const dataWithDeliveryInfo = mapDeliveryInfoToItems(result.data || []);

        // 현재 활성화된 상태에 따라 필터링
        const filteredByStatus = filterByStatus(dataWithDeliveryInfo, activeStatus);

        // 구글 시트 데이터를 테이블에 직접 표시
        const sortedData = sortData(filteredByStatus, sortType);
        setOriginalData(dataWithDeliveryInfo);
        setItemData(dataWithDeliveryInfo);
        setFilteredData(sortedData);

        // 데이터를 캐시에 저장 (구글시트 ID 포함)
        saveToCache(selectedCoupangUser, dataWithDeliveryInfo, selectedUser.googlesheet_id);

        setLoading(false);
        setIsLoadingFromCache(false); // 플래그 해제

        // 로드 시간 정보 포함
        const loadTimeInfo = result.loadTime ? ` (${(result.loadTime / 1000).toFixed(1)}초)` : '';
        alert(`${result.message}${loadTimeInfo}`);
      } else {
        const errorMessage = result.error || result.details || '구글 시트 데이터를 불러오는데 실패했습니다.';
        console.error('구글 시트 API 오류:', errorMessage);
        alert(errorMessage);
        setLoading(false);
        setIsLoadingFromCache(false);
      }
    } catch (error) {
      console.error('구글 시트 데이터 불러오기 오류:', error);
      alert(`구글 시트 데이터를 불러오는데 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setLoading(false);
      setIsLoadingFromCache(false);
    }
  };

  // 엑셀 업로드 버튼 클릭 핸들러
  const handleExcelUpload = () => {
    excelFileInputRef.current?.click();
  };

  // 엑셀 파일 선택 시 처리 함수
  const handleExcelFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 엑셀 파일 형식 확인
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
      return;
    }

    setIsUploadingExcel(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      console.log('엑셀 파일 업로드 시작:', file.name);

      const response = await fetch('/api/upload-delivery-excel', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        alert(`엑셀 파일이 성공적으로 업로드되었습니다.\n저장된 데이터: ${result.count || 0}개`);
        console.log('업로드 성공:', result);

        // 배송정보 다시 로딩
        await fetchAllDeliveryInfo();
        console.log('배송정보 데이터 새로고침 완료');
      } else {
        console.error('업로드 실패:', result);
        alert(result.error || '업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('업로드 중 예외 발생:', error);
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setIsUploadingExcel(false);
      // 파일 입력 초기화
      if (excelFileInputRef.current) {
        excelFileInputRef.current.value = '';
      }
    }
  };

  // 비용 클릭 시 URL 입력받아 새 탭으로 열기
  const handleCostClick = (e: React.MouseEvent, item: ItemData) => {
    e.preventDefault();
    e.stopPropagation();

    // L열에 URL이 있으면 바로 열기
    if (item.site_url && item.site_url.trim()) {
      let fullUrl = item.site_url.trim();
      if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
        fullUrl = 'https://' + fullUrl;
      }
      console.log('사이트 URL로 이동:', fullUrl);
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // URL이 없으면 입력받기
    const url = prompt('사이트 URL을 입력하세요:');
    if (url && url.trim()) {
      let fullUrl = url.trim();
      if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
        fullUrl = 'https://' + fullUrl;
      }
      console.log('입력한 URL로 이동:', fullUrl);
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    }
  };


  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  
  // 마우스 위치 추적 함수
  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  };

  // 바코드 버튼 클릭 핸들러 (Sheet)
  const handleBarcodeClick = () => {
    if (selectedRows.size === 0) {
      alert('바코드를 생성할 항목을 선택해주세요.');
      return;
    }

    // 선택된 항목들의 바코드 정보 수집
    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));

    // 바코드가 있는 항목만 필터링
    const itemsWithBarcode = selectedItems.filter(item => item.barcode);

    if (itemsWithBarcode.length === 0) {
      alert('선택한 항목에 바코드 정보가 없습니다.');
      return;
    }

    // 초기 수량 설정 ('입고' 열 데이터 또는 기본값 1)
    const initialQuantities: { [key: string]: number } = {};
    itemsWithBarcode.forEach(item => {
      initialQuantities[item.id] = item.import_qty || 1;
    });
    setProductQuantities(initialQuantities);

    // 수량 입력 다이얼로그 표시
    setShowQuantityDialog(true);
  };

  // 바코드 DB 저장 버튼 클릭 핸들러
  const handleBarcodeDBClick = async () => {
    if (selectedRows.size === 0) {
      alert('바코드를 생성할 항목을 선택해주세요.');
      return;
    }

    // 선택된 항목들의 바코드 정보 수집
    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));

    // 바코드가 있는 항목만 필터링
    const itemsWithBarcode = selectedItems.filter(item => item.barcode);

    if (itemsWithBarcode.length === 0) {
      alert('선택한 항목에 바코드 정보가 없습니다.');
      return;
    }

    try {
      setIsSavingLabel(true);

      // Supabase에 저장할 데이터 준비
      const barcodeData = itemsWithBarcode.map((item, index) => ({
        id: String(index + 1).padStart(4, '0'), // 0001부터 시작
        brand: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
        item_name: `${item.china_option1 || ''}${item.china_option1 && item.china_option2 ? ' ' : ''}${item.china_option2 || ''}`.trim(),
        barcode: item.barcode || '',
        qty: item.import_qty || 1,
        order_number: item.order_number || ''
      }));

      // API를 통해 Supabase에 저장
      const response = await fetch('/api/save-barcode-to-db', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ barcodeData }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(`바코드 데이터가 DB에 저장되었습니다.\n저장된 아이템: ${result.count}개`);
        setSelectedRows(new Set()); // 선택 해제
      } else {
        console.error('DB 저장 실패:', result);
        alert(`DB 저장에 실패했습니다.\n오류: ${result.error || '알 수 없는 오류'}`);
      }

    } catch (error) {
      console.error('DB 저장 중 오류:', error);
      alert('DB 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingLabel(false);
    }
  };

  // 폴백 다운로드 함수 (File System Access API를 지원하지 않는 브라우저용)
  const fallbackDownload = (jsonContent: string, itemCount: number) => {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'barcode.json';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    
    alert(`바코드 데이터가 다운로드되었습니다.\n저장된 아이템: ${itemCount}개`);
  };

  // 수량 입력 후 LABEL 시트에 저장
  const handleQuantityConfirm = async () => {
    // 현재 선택된 사용자의 구글시트 정보 확인
    if (!selectedCoupangUser) {
      alert('먼저 쿠팡 사용자를 선택해주세요.');
      return;
    }

    setIsSavingLabel(true);

    // localStorage에서 구글시트 ID 가져오기
    const cacheKey = `sheet_data_${selectedCoupangUser}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!cachedData) {
      alert('구글시트 데이터를 먼저 불러와주세요.');
      return;
    }

    let googlesheetId;
    try {
      const parsedCache = JSON.parse(cachedData);
      googlesheetId = parsedCache.googlesheet_id;
    } catch (error) {
      console.error('캐시 파싱 오류:', error);
      alert('구글시트 정보를 가져올 수 없습니다.');
      return;
    }

    if (!googlesheetId) {
      alert('구글시트 ID를 찾을 수 없습니다. 다시 시트를 불러와주세요.');
      return;
    }

    // 바코드 데이터 준비 (수량과 주문번호 포함)
    const labelData: Array<{name: string, barcode: string, qty: number, order_number: string}> = [];

    Object.entries(productQuantities).forEach(([id, quantity]) => {
      const item = filteredData.find(item => item.id === id);
      if (item && item.barcode) {
        // 주문번호에 상품 입고 사이즈 변환하여 추가
        let orderNumber = item.order_number || '';
        if (item.product_size && item.product_size.trim()) {
          const sizeText = item.product_size.trim();
          let sizeCode = '';
          if (sizeText.toLowerCase().includes('small')) {
            sizeCode = 'A';
          } else if (sizeText.toLowerCase().includes('medium')) {
            sizeCode = 'B';
          } else if (sizeText.toLowerCase().includes('large')) {
            sizeCode = 'C';
          } else {
            // 기타 사이즈는 첫 글자 사용
            sizeCode = sizeText.charAt(0);
          }
          orderNumber = `${orderNumber}-${sizeCode}`;
        }

        labelData.push({
          name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
          barcode: item.barcode,
          qty: quantity,
          order_number: orderNumber
        });
      }
    });

    if (labelData.length > 0) {
      try {
        console.log('LABEL 시트에 데이터 저장 시작...');
        console.log('저장할 데이터:', labelData);

        // LABEL 시트에 데이터 저장 API 호출
        const response = await fetch('/api/save-label-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            labelData: labelData,
            googlesheet_id: googlesheetId,
            coupang_name: selectedCoupangUser
          }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          alert(`LABEL 시트에 바코드 데이터가 저장되었습니다.\n저장된 아이템: ${result.count}개`);

          setShowQuantityDialog(false);
          setProductQuantities({});
          setSelectedRows(new Set());
        } else {
          console.error('LABEL 시트 저장 실패:', result);
          alert(`LABEL 시트 저장에 실패했습니다.\n오류: ${result.message || result.error || '알 수 없는 오류'}`);
        }

      } catch (error) {
        console.error('LABEL 시트 저장 중 오류:', error);
        alert('LABEL 시트 저장 중 오류가 발생했습니다.');
      } finally {
        setIsSavingLabel(false);
      }
    }
  };


  // 저장 버튼 클릭 핸들러 (배치 저장)
  const handleSaveClick = async () => {
    if (Object.keys(modifiedData).length === 0) return;

    // 현재 선택된 사용자의 구글시트 정보 확인
    if (!selectedCoupangUser) {
      alert('먼저 쿠팡 사용자를 선택해주세요.');
      return;
    }

    // localStorage에서 구글시트 ID 가져오기
    const cacheKey = `sheet_data_${selectedCoupangUser}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!cachedData) {
      alert('구글시트 데이터를 먼저 불러와주세요.');
      return;
    }

    let googlesheetId;
    try {
      const parsedCache = JSON.parse(cachedData);
      googlesheetId = parsedCache.googlesheet_id;
    } catch (error) {
      console.error('캐시 파싱 오류:', error);
      alert('구글시트 정보를 가져올 수 없습니다.');
      return;
    }

    if (!googlesheetId) {
      alert('구글시트 ID를 찾을 수 없습니다. 다시 시트를 불러와주세요.');
      return;
    }

    setIsSaving(true);
    const saveStartTime = Date.now();
    console.log('배치 저장 시작, 수정된 데이터:', modifiedData);
    console.log('구글시트 ID:', googlesheetId, '사용자:', selectedCoupangUser);

    try {
      // 수정된 데이터를 배치 업데이트 형식으로 변환
      const updates: Array<{ rowId: string; field: string; value: number | string | null }> = [];

      Object.entries(modifiedData).forEach(([rowId, fields]) => {
        Object.entries(fields).forEach(([field, value]) => {
          updates.push({ rowId, field, value });
        });
      });

      console.log(`총 ${updates.length}개 셀 배치 저장 요청`);

      // 배치 저장 API 호출
      const response = await fetch('/api/save-cells-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          googlesheet_id: googlesheetId,
          coupang_name: selectedCoupangUser,
          updates: updates
        }),
      });

      const result = await response.json();
      const saveEndTime = Date.now();
      const totalSaveTime = ((saveEndTime - saveStartTime) / 1000).toFixed(2);

      console.log('배치 저장 결과:', result);
      console.log(`저장 완료 시간: ${totalSaveTime}초`);

      if (response.ok && result.success) {
        const { successCount, failedCount, failedDetails, successDetails } = result.details;

        if (failedCount === 0) {
          // 전체 저장 성공 → 검증 시작
          console.log('저장 성공, 검증 시작...');

          try {
            // 저장된 셀 검증
            const verifyResponse = await fetch('/api/verify-saved-cells', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                googlesheet_id: googlesheetId,
                coupang_name: selectedCoupangUser,
                verifications: successDetails.map((item: any) => ({
                  rowId: item.rowId,
                  field: item.field,
                  expectedValue: item.value
                }))
              }),
            });

            const verifyResult = await verifyResponse.json();
            console.log('검증 결과:', verifyResult);

            if (verifyResponse.ok && verifyResult.success) {
              if (verifyResult.allMatch) {
                // 전체 검증 성공
                setModifiedData({}); // 수정 데이터 초기화
                const verifyTime = (verifyResult.details.totalTime / 1000).toFixed(2);
                alert(`✅ 저장 및 검증 완료!\n\n📊 저장: ${successCount}개\n🔍 검증: ${verifyResult.details.matchCount}/${verifyResult.details.totalChecked}개 일치\n⏱️ 총 소요 시간: ${totalSaveTime}초\n⏱️ 검증 시간: ${verifyTime}초`);
              } else {
                // 일부 불일치
                const mismatches = verifyResult.details.mismatches || [];
                const mismatchInfo = mismatches.map((m: any) =>
                  `행 ${m.rowId} - ${m.field}: 예상값 "${m.expected}" ≠ 실제값 "${m.actual}"`
                ).join('\n');

                alert(`⚠️ 저장되었으나 일부 데이터가 불일치합니다.\n\n✅ 일치: ${verifyResult.details.matchCount}개\n❌ 불일치: ${verifyResult.details.mismatchCount}개\n\n불일치 항목:\n${mismatchInfo}\n\n시트를 다시 불러와서 확인해주세요.`);

                // 불일치 항목만 modifiedData에 남김
                const newModifiedData: {[key: string]: {[field: string]: number | string | null}} = {};
                mismatches.forEach((m: any) => {
                  if (!newModifiedData[m.rowId]) {
                    newModifiedData[m.rowId] = {};
                  }
                  newModifiedData[m.rowId][m.field] = m.expected;
                });
                setModifiedData(newModifiedData);
              }
            } else {
              // 검증 실패 (네트워크 오류 등)
              console.error('검증 실패:', verifyResult);
              setModifiedData({}); // 일단 초기화
              alert(`⚠️ 저장은 완료되었으나 검증에 실패했습니다.\n\n📊 저장 완료: ${successCount}개\n⏱️ 소요 시간: ${totalSaveTime}초\n\n검증 오류: ${verifyResult.error || '알 수 없는 오류'}\n\n시트를 새로고침하여 확인해주세요.`);
            }
          } catch (verifyError) {
            // 검증 중 예외 발생
            console.error('검증 중 오류:', verifyError);
            setModifiedData({}); // 일단 초기화
            alert(`⚠️ 저장은 완료되었으나 검증 중 오류가 발생했습니다.\n\n📊 저장 완료: ${successCount}개\n⏱️ 소요 시간: ${totalSaveTime}초\n\n시트를 새로고침하여 확인해주세요.`);
          }
        } else {
          // 부분 성공
          const failedInfo = failedDetails?.map((f: any) => `행 ${f.rowId} - ${f.field}: ${f.error}`).join('\n') || '';
          alert(`⚠️ 일부 데이터가 저장되었습니다.\n\n✅ 성공: ${successCount}개\n❌ 실패: ${failedCount}개\n\n실패 항목:\n${failedInfo}`);

          // 성공한 항목들만 modifiedData에서 제거
          const newModifiedData = { ...modifiedData };
          successDetails?.forEach((item: any) => {
            if (newModifiedData[item.rowId]) {
              delete newModifiedData[item.rowId][item.field];

              // 해당 rowId의 모든 필드가 저장되었으면 rowId 자체를 삭제
              if (Object.keys(newModifiedData[item.rowId]).length === 0) {
                delete newModifiedData[item.rowId];
              }
            }
          });
          setModifiedData(newModifiedData);
        }
      } else {
        // 전체 실패
        console.error('배치 저장 실패:', result);
        alert(`❌ 데이터 저장에 실패했습니다.\n\n오류: ${result.error || result.details || '알 수 없는 오류'}\n\n네트워크 연결을 확인해주세요.`);
      }

    } catch (error) {
      console.error('저장 중 오류 발생:', error);
      alert(`❌ 데이터 저장 중 오류가 발생했습니다.\n\n${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="item-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="item-main-content">
        <LeftsideMenu />
        <main className="item-content">
          <div className="item-container">
            <h1 className="item-title">{t('importProduct.title')}</h1>
            
            {/* 시트 불러오기 버튼 - 카드 위로 이동 */}
            <div className="excel-upload-section">
              <select
                className="coupang-user-dropdown"
                value={selectedCoupangUser}
                onChange={(e) => setSelectedCoupangUser(e.target.value)}
              >
                <option value="">{t('importProduct.selectUser')}</option>
                {coupangUsers.map((user) => {
                  // 캐시 데이터 확인
                  const cacheKey = `sheet_data_${user.coupang_name}`;
                  const hasCachedData = localStorage.getItem(cacheKey) !== null;

                  return (
                    <option key={user.coupang_name} value={user.coupang_name}>
                      {user.coupang_name} {hasCachedData ? '●' : ''}
                    </option>
                  );
                })}
              </select>
              <button className="excel-upload-btn" onClick={handleLoadGoogleSheet}>
                {t('importProduct.refresh')}
              </button>
              <button
                className="excel-upload-btn"
                onClick={handleExcelUpload}
                disabled={isUploadingExcel}
              >
                {isUploadingExcel ? t('importProduct.uploading') : t('importProduct.uploadExcel')}
              </button>

              {/* 숨겨진 엑셀 파일 입력 요소 */}
              <input
                type="file"
                ref={excelFileInputRef}
                onChange={handleExcelFileChange}
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
              />
            </div>
            
            {/* 상태 카드들 */}
            <div className="status-cards">
              {cardData.map((status, index) => {
                // 각 상태별 카운트 계산 (useMemo로 캐싱된 값 사용)
                const count = statusCounts[status] || 0;
                const isActive = activeStatus === status;

                return (
                  <StatusCard
                    key={index}
                    label={status}
                    count={count}
                    isActive={isActive}
                    onClick={() => handleStatusCardClick(status)}
                  />
                );
              })}
            </div>

            {/* 정렬 옵션과 저장 버튼 - 검색 입력폼 위로 이동 */}
            <div className="control-section">
              <div className="left-controls">
                <select
                  className="sort-dropdown"
                  value={sortType}
                  onChange={handleSortTypeChange}
                >
                  <option value="주문순서">{t('importProduct.sortOrder')}</option>
                  <option value="품목별">{t('importProduct.sortByProduct')}</option>
                </select>
              </div>
              <div className="right-controls">
                <button
                  className={`excel-download-btn ${Object.keys(modifiedData).length > 0 ? 'active' : ''}`}
                  onClick={handleSaveClick}
                  disabled={Object.keys(modifiedData).length === 0 || isSaving}
                >
                  {isSaving ? t('importProduct.saving') : t('importProduct.save')}
                </button>
                <button className="barcode-btn" onClick={handleBarcodeClick}>{t('importProduct.generateBarcode')}</button>
                <button className="barcode-btn-db" onClick={handleBarcodeDBClick}>{t('importProduct.generateBarcodeDB')}</button>
              </div>
            </div>

            {/* 검색 영역 */}
            <div className="search-section">
              <div className="search-board">
                <div className="search-form-container">
                  <select
                    className="search-dropdown"
                    value={searchType}
                    onChange={handleSearchTypeChange}
                  >
                    <option value="배송번호">{t('importProduct.searchType.deliveryNumber')}</option>
                    <option value="일반검색">{t('importProduct.searchType.general')}</option>
                  </select>
                  <input
                    type="text"
                    placeholder={searchType === '배송번호' ? t('importProduct.searchPlaceholder.deliveryNumber') : t('importProduct.searchPlaceholder.general')}
                    className="search-input"
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="search-button" onClick={handleSearchClick}>{t('importProduct.search')}</button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div className="table-board">
              <table className="item-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = isIndeterminate;
                        }}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="table-checkbox"
                      />
                    </th>
                    <th>{t('importProduct.table.image')}</th>
                    <th>{t('importProduct.table.orderNumber')}</th>
                    <th>{t('importProduct.table.productName')}</th>
                    <th>{t('importProduct.table.orderOption')}</th>
                    <th>{t('importProduct.table.quantity')}</th>
                    <th>{t('importProduct.table.cost')}</th>
                    <th>{t('importProduct.table.progress')}</th>
                    <th>{t('importProduct.table.import')}</th>
                    <th>{t('importProduct.table.cancel')}</th>
                    <th>{t('importProduct.table.export')}</th>
                    <th>{t('importProduct.table.note')}</th>
                    <th>{t('importProduct.table.info')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={13} className="empty-data">{t('importProduct.table.loading')}</td>
                    </tr>
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="empty-data">{t('importProduct.table.noData')}</td>
                    </tr>
                  ) : (
                    paginatedData.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(item.id)}
                            onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                            className="table-checkbox"
                          />
                        </td>
                        <td>
                          {item.img_url ? (
                            <div className="image-preview-container">
                              <img
                                src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                                alt="상품 이미지"
                                className="product-thumbnail"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/placeholder.svg';
                                }}
                              />
                              <div
                                className="image-preview"
                                style={{
                                  top: `${mousePosition.y - 300}px`,
                                  left: `${mousePosition.x + 30}px`
                                }}
                              >
                                <img
                                  src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                                  alt="상품 이미지 미리보기"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="no-image">{t('importProduct.table.noImage')}</div>
                          )}
                        </td>
                        <td>
                          <div className="order-number-text">
                            {item.order_number_prefix || ''}
                            {item.order_number_prefix && item.order_number && <br />}
                            {item.order_number || ''}
                          </div>
                        </td>
                        <td>
                          <div className="product-name">
                            {item.product_name || '-'}
                            {item.product_name_sub && (
                              <>
                                <br />
                                {item.product_name_sub}
                              </>
                            )}
                            {item.barcode && (
                              <>
                                <br />
                                {item.barcode}
                                {item.option_id ? ` | ${item.option_id}` : ''}
                                {item.product_size && String(item.product_size).trim() ? ` | ${(() => {
                                  const sizeText = String(item.product_size).trim();
                                  if (sizeText.toLowerCase().includes('small')) return 'A';
                                  if (sizeText.toLowerCase().includes('medium')) return 'B';
                                  if (sizeText.toLowerCase().includes('large')) return 'C';
                                  return sizeText.charAt(0);
                                })()}` : ''}
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="china-options">
                            {item.china_option1 || '-'}
                            {item.china_option2 && (
                              <>
                                <br />
                                {item.china_option2}
                              </>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {item.order_qty || 0}
                        </td>
                        <td>
                          <div
                            className="cost-display clickable-cost"
                            onClick={(e) => handleCostClick(e, item)}
                            title={item.site_url ? '클릭하여 사이트로 이동' : 'URL을 입력하여 사이트로 이동'}
                          >
                            {item.cost_main || '-'}
                            {item.cost_sub && (
                              <>
                                <br />
                                {item.cost_sub}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="qty-cell">
                          {item.progress_qty && (
                            <span className="qty-badge progress-qty">
                              {item.progress_qty}
                            </span>
                          )}
                        </td>
                        <td
                          className="qty-cell editable-qty-cell"
                          onClick={() => startEditingCell(item.id, 'import_qty', item.import_qty)}
                        >
                          {editingCell?.id === item.id && editingCell?.field === 'import_qty' ? (
                            <input
                              type="number"
                              value={cellValue}
                              onChange={handleCellValueChange}
                              onKeyDown={handleCellKeyDown}
                              onBlur={() => finishEditingCell(false)}
                              className="qty-input-seamless"
                              autoFocus
                            />
                          ) : (
                            <div className="qty-display-seamless">
                              {item.import_qty || ''}
                            </div>
                          )}
                        </td>
                        <td
                          className="qty-cell editable-qty-cell"
                          onClick={() => startEditingCell(item.id, 'cancel_qty', item.cancel_qty)}
                        >
                          {editingCell?.id === item.id && editingCell?.field === 'cancel_qty' ? (
                            <input
                              type="number"
                              value={cellValue}
                              onChange={handleCellValueChange}
                              onKeyDown={handleCellKeyDown}
                              onBlur={() => finishEditingCell(false)}
                              className="qty-input-seamless"
                              autoFocus
                            />
                          ) : (
                            <div className="qty-display-seamless">
                              {item.cancel_qty || ''}
                            </div>
                          )}
                        </td>
                        <td className="qty-cell">
                          {item.export_qty && (
                            <span className="qty-badge export-qty">
                              {item.export_qty}
                            </span>
                          )}
                        </td>
                        <td
                          className="editable-note-cell"
                          onClick={() => startEditingCell(item.id, 'note', item.note)}
                        >
                          {editingCell?.id === item.id && editingCell?.field === 'note' ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onKeyDown={handleCellKeyDown}
                              onBlur={() => finishEditingCell(false)}
                              className="note-input-seamless"
                              autoFocus
                            />
                          ) : (
                            <div className="note-display-seamless">
                              {item.note || ''}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ lineHeight: '1.5', fontSize: '14px', color: '#333' }}>
                            {item.order_id && <div>{item.order_id}</div>}
                            {item.delivery_status && (
                              <div style={{ marginTop: '4px' }}>
                                {item.delivery_status === '等待买家确认收货' && '🟢 等待买家确认收货'}
                                {item.delivery_status === '交易关闭' && '🏁 交易关闭'}
                                {item.delivery_status === '退款中' && '↩️ 退款中'}
                                {item.delivery_status === '等待卖家发货' && '🟡 等待卖家发货'}
                                {item.delivery_status === '交易成功' && '✔️ 交易成功'}
                                {!['等待买家确认收货', '交易关闭', '退款中', '等待卖家发货', '交易成功'].includes(item.delivery_status) && item.delivery_status}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            {/* 페이지네이션 */}
            {!loading && filteredData.length > 0 && (
              <div className="pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>
                
                <div className="page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // 현재 페이지 주변의 페이지 번호만 표시
                    let pageNum;
                    if (totalPages <= 5) {
                      // 전체 페이지가 5개 이하면 모든 페이지 번호 표시
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      // 현재 페이지가 1, 2, 3인 경우 1~5 표시
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      // 현재 페이지가 마지막에 가까운 경우
                      pageNum = totalPages - 4 + i;
                    } else {
                      // 그 외의 경우 현재 페이지 중심으로 표시
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>


      {/* 수량 입력 다이얼로그 */}
      {showQuantityDialog && (
        <div className="quantity-dialog-overlay" onClick={() => setShowQuantityDialog(false)}>
          <div className="quantity-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="quantity-dialog-header">
              <h2>{t('importProduct.dialog.quantityTitle')}</h2>
              <button className="close-btn" onClick={() => setShowQuantityDialog(false)}>×</button>
            </div>
            <div className="quantity-dialog-content">
              <table className="quantity-table">
                <thead>
                  <tr>
                    <th>{t('importProduct.dialog.productInfo')}</th>
                    <th>{t('importProduct.dialog.quantity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData
                    .filter(item => selectedRows.has(item.id) && item.barcode)
                    .map(item => (
                      <tr key={item.id}>
                        <td>
                          <div className="product-info-text">
                            <div style={{color: '#333', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>
                              {item.product_name} {item.product_name_sub}
                            </div>
                            <div style={{color: '#333', fontSize: '14px', marginBottom: '8px'}}>
                              {item.china_option1} {item.china_option2}
                            </div>
                            <div style={{lineHeight: '1.6'}}>
                              <span className="info-tag order-number">
                                {item.order_number || ''}
                              </span>
                              <span className="info-tag barcode">
                                {item.barcode}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={productQuantities[item.id] || item.import_qty || 1}
                            onChange={(e) => {
                              const value = parseInt(e.target.value) || 1;
                              setProductQuantities({
                                ...productQuantities,
                                [item.id]: value
                              });
                            }}
                            className="quantity-input"
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="quantity-dialog-actions">
              <button className="cancel-btn" onClick={() => setShowQuantityDialog(false)}>
                {t('importProduct.dialog.cancel')}
              </button>
              <button
                className="confirm-btn"
                onClick={handleQuantityConfirm}
                disabled={isSavingLabel}
              >
                {isSavingLabel ? t('importProduct.dialog.saving') : t('importProduct.dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemCheck; 