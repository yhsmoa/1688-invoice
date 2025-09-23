'use client';

import React, { useRef, useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import Card from '../../component/Card';
import SearchForm from '../../component/SearchForm';
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
  note?: string | null; // 비고 (Q열)
  option_id?: string | null; // 옵션 ID (U열)
  product_size?: string | null; // 상품 입고 사이즈 (V열)
  // 기존 필드들 (호환성을 위해 남겨둠)
  date?: string;
  row_id?: string;
  confirm_qty?: number | null;
}

const ItemCheck: React.FC = () => {
  const cardData = ['전체', '미입고', '부분입고', '입고완료', '불량', '반품'];
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<ItemData[]>([]);
  const [originalData, setOriginalData] = useState<ItemData[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>('전체');
  const [searchType, setSearchType] = useState<string>('배송번호');
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
  const [modifiedData, setModifiedData] = useState<{[key: string]: {[field: string]: number | null}}>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // 정렬 상태
  const [sortType, setSortType] = useState<string>('주문순서');

  // 엑셀 업로드 관련 상태
  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);

  // 배송정보 상태 (초기 로딩용)
  const [deliveryInfoData, setDeliveryInfoData] = useState<{[key: string]: any}>({});

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
        const sortedData = sortData(parsedData.data || [], sortType);
        setOriginalData(parsedData.data || []);
        setItemData(parsedData.data || []);
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

  // 검색 함수 - 메모리 기반 검색으로 변경
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      const sortedData = sortData(itemData, sortType);
      setFilteredData(sortedData); // 검색어가 없으면 모든 데이터 표시 (정렬 적용)
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

      const sortedData = sortData(searchResults, sortType);
      setFilteredData(sortedData);

      console.log(`검색 완료: "${searchTerm}" - ${searchResults.length}개 결과`);

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
    const sortedData = sortData(itemData, sortType);
    setFilteredData(sortedData); // 전체 데이터 표시 (정렬 적용)
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
        // 구글 시트 데이터를 테이블에 직접 표시
        const sortedData = sortData(result.data || [], sortType);
        setOriginalData(result.data || []);
        setItemData(result.data || []);
        setFilteredData(sortedData);
        
        // 데이터를 캐시에 저장 (구글시트 ID 포함)
        saveToCache(selectedCoupangUser, result.data || [], selectedUser.googlesheet_id);
        
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

  // 바코드 버튼 클릭 핸들러
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

  // 저장된 데이터 검증 함수
  const verifyDataConsistency = async (googlesheetId: string, savedData: any[]) => {
    try {
      console.log('데이터 일치성 검증 시작...');

      // 저장 후 데이터 다시 가져오기
      const response = await fetch(`/api/load-google-sheet-optimized?googlesheet_id=${googlesheetId}&coupang_name=${encodeURIComponent(selectedCoupangUser)}&cache=false`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('검증을 위한 데이터 다시 로드 실패');
      }

      const result = await response.json();
      if (!result.success || !result.data) {
        throw new Error('검증 데이터가 유효하지 않음');
      }

      const updatedData = result.data;
      const inconsistencies: string[] = [];

      // 저장된 각 항목에 대해 검증
      savedData.forEach(savedItem => {
        const updatedItem = updatedData.find((item: any) => item.row_number === savedItem.rowId);

        if (!updatedItem) {
          inconsistencies.push(`행 ${savedItem.rowId}: 데이터를 찾을 수 없음`);
          return;
        }

        // 저장된 필드값과 실제 데이터 비교
        if (savedItem.field === 'import_qty') {
          const savedValue = savedItem.value;
          const actualValue = updatedItem.import_qty;

          if (savedValue !== actualValue) {
            inconsistencies.push(`행 ${savedItem.rowId}: 입고 수량 불일치 (저장값: ${savedValue}, 실제값: ${actualValue})`);
          }
        } else if (savedItem.field === 'cancel_qty') {
          const savedValue = savedItem.value;
          const actualValue = updatedItem.cancel_qty;

          if (savedValue !== actualValue) {
            inconsistencies.push(`행 ${savedItem.rowId}: 취소 수량 불일치 (저장값: ${savedValue}, 실제값: ${actualValue})`);
          }
        } else if (savedItem.field === 'note') {
          const savedValue = savedItem.value;
          const actualValue = updatedItem.note;

          if (savedValue !== actualValue) {
            inconsistencies.push(`행 ${savedItem.rowId}: 비고 불일치 (저장값: "${savedValue}", 실제값: "${actualValue}")`);
          }
        }
      });

      return {
        isConsistent: inconsistencies.length === 0,
        inconsistencies
      };

    } catch (error) {
      console.error('데이터 검증 중 오류:', error);
      return {
        isConsistent: false,
        inconsistencies: ['데이터 검증 중 오류가 발생했습니다.'],
        error: error.message
      };
    }
  };

  // 저장 버튼 클릭 핸들러 (순차 저장)
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
    console.log('저장 시작, 수정된 데이터:', modifiedData);
    console.log('구글시트 ID:', googlesheetId, '사용자:', selectedCoupangUser);

    try {
      // 수정된 데이터를 개별 저장 요청으로 변환
      const savePromises: Promise<any>[] = [];
      let totalUpdates = 0;

      Object.entries(modifiedData).forEach(([rowId, fields]) => {
        Object.entries(fields).forEach(([field, value]) => {
          totalUpdates++;
          const savePromise = fetch('/api/save-cell-value', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              row_id: rowId,
              field,
              value,
              googlesheet_id: googlesheetId,
              coupang_name: selectedCoupangUser
            }),
          })
          .then(async response => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const result = await response.json();
            return {
              rowId,
              field,
              value,
              success: result.success !== false,
              result
            };
          })
          .catch(error => {
            console.error(`저장 실패 - rowId: ${rowId}, field: ${field}:`, error);
            return {
              rowId,
              field,
              value,
              success: false,
              error: error.message
            };
          });

          savePromises.push(savePromise);
        });
      });

      console.log(`총 ${totalUpdates}개 업데이트 요청 시작`);

      // 모든 저장 요청 실행
      const results = await Promise.all(savePromises);

      console.log('저장 결과:', results);

      // 성공/실패 개수 계산
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;

      if (failureCount === 0) {
        // 전체 성공 - 데이터 일치성 검증 수행
        const successfulSaves = results.filter(r => r.success);

        console.log('저장 완료, 데이터 일치성 검증 시작...');
        const verification = await verifyDataConsistency(googlesheetId, successfulSaves);

        if (verification.isConsistent) {
          setModifiedData({}); // 수정 데이터 초기화
          alert(`모든 변경사항이 저장되었습니다. (${successCount}개 완료)\n✅ 데이터 일치성 검증 완료`);
        } else {
          // 데이터 불일치 발견
          console.error('데이터 불일치 발견:', verification.inconsistencies);
          alert(`저장은 완료되었으나 일부 데이터가 일치하지 않습니다:\n\n${verification.inconsistencies.join('\n')}\n\n다시 시트를 불러와서 확인해주세요.`);
        }
      } else if (successCount > 0) {
        // 부분 성공
        alert(`일부 데이터가 저장되었습니다.\n성공: ${successCount}개, 실패: ${failureCount}개`);

        // 성공한 항목들만 modifiedData에서 제거
        const newModifiedData = { ...modifiedData };
        results.forEach(result => {
          if (result.success && newModifiedData[result.rowId]) {
            delete newModifiedData[result.rowId][result.field];

            // 해당 rowId의 모든 필드가 저장되었으면 rowId 자체를 삭제
            if (Object.keys(newModifiedData[result.rowId]).length === 0) {
              delete newModifiedData[result.rowId];
            }
          }
        });
        setModifiedData(newModifiedData);
      } else {
        // 전체 실패
        alert('데이터 저장에 실패했습니다. 네트워크 연결을 확인해주세요.');
      }

    } catch (error) {
      console.error('저장 중 오류 발생:', error);
      alert('데이터 저장 중 오류가 발생했습니다.');
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
            <h1 className="item-title">상품 입고</h1>
            
            {/* 시트 불러오기 버튼 - 카드 위로 이동 */}
            <div className="excel-upload-section">
              <select
                className="coupang-user-dropdown"
                value={selectedCoupangUser}
                onChange={(e) => setSelectedCoupangUser(e.target.value)}
              >
                <option value="">쿠팡 사용자 선택</option>
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
                시트 불러오기
              </button>
              <button
                className="excel-upload-btn"
                onClick={handleExcelUpload}
                disabled={isUploadingExcel}
              >
                {isUploadingExcel ? '업로드 중...' : '엑셀 불러오기'}
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
              {cardData.map((status, index) => (
                <Card key={index} className="status-card">
                  <div className="status-content">
                    <span className="status-text">{status}</span>
                    <span className="status-count">{filteredData.length}</span>
                  </div>
                </Card>
              ))}
            </div>

            {/* 정렬 옵션과 저장 버튼 - 검색 입력폼 위로 이동 */}
            <div className="control-section">
              <div className="left-controls">
                <select 
                  className="sort-dropdown"
                  value={sortType}
                  onChange={handleSortTypeChange}
                >
                  <option value="주문순서">주문순서</option>
                  <option value="품목별">품목별</option>
                </select>
              </div>
              <div className="right-controls">
                <button 
                  className={`excel-download-btn ${Object.keys(modifiedData).length > 0 ? 'active' : ''}`}
                  onClick={handleSaveClick}
                  disabled={Object.keys(modifiedData).length === 0 || isSaving}
                >
                  {isSaving ? '저장 중...' : '저장'}
                </button>
                <button className="barcode-btn" onClick={handleBarcodeClick}>바코드 생성</button>
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
                    <option value="배송번호">배송번호</option>
                    <option value="일반검색">일반검색</option>
                  </select>
                  <input 
                    type="text" 
                    placeholder={searchType === '배송번호' ? '배송번호를 입력하세요' : '상품명, 오퍼ID, 바코드를 입력하세요'} 
                    className="search-input"
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="search-button" onClick={handleSearchClick}>검색</button>
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
                    <th>이미지</th>
                    <th>글번호</th>
                    <th>상품명</th>
                    <th>주문옵션</th>
                    <th>개수</th>
                    <th>비용</th>
                    <th>진행</th>
                    <th>입고</th>
                    <th>취소</th>
                    <th>출고</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={12} className="empty-data">로딩 중...</td>
                    </tr>
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="empty-data">검색 결과가 없습니다.</td>
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
                            <div className="no-image">이미지 없음</div>
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
                                {item.product_size && item.product_size.trim() ? ` | ${(() => {
                                  const sizeText = item.product_size.trim();
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
                        <td>
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
                  이전
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
                  다음
                </button>
                
                <span className="page-info">
                  {currentPage} / {totalPages} 페이지 (총 {filteredData.length}개)
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
              <h2>바코드 라벨 수량 입력</h2>
              <button className="close-btn" onClick={() => setShowQuantityDialog(false)}>×</button>
            </div>
            <div className="quantity-dialog-content">
              <table className="quantity-table">
                <thead>
                  <tr>
                    <th>상품정보</th>
                    <th>수량</th>
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
                취소
              </button>
              <button
                className="confirm-btn"
                onClick={handleQuantityConfirm}
                disabled={isSavingLabel}
              >
                {isSavingLabel ? '저장 중...' : 'LABEL 시트에 저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemCheck; 