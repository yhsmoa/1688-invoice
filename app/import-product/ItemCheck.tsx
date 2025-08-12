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
  // 기존 필드들 (호환성을 위해 남겨둠)
  date?: string;
  row_id?: string;
  confirm_qty?: number | null;
}

const ItemCheck: React.FC = () => {
  const cardData = ['전체', '미입고', '부분입고', '입고완료', '불량', '반품'];
  const [itemData, setItemData] = useState<ItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemData | null>(null);
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
  const startEditingCell = (id: string, field: string, value: number | null | undefined) => {
    setEditingCell({ id, field });
    setCellValue(value !== null && value !== undefined ? value.toString() : '');
  };

  // 셀 편집 완료
  const finishEditingCell = async () => {
    if (editingCell) {
      const { id, field } = editingCell;
      const numValue = cellValue === '' ? null : Number(cellValue);
      
      // 현재 아이템 찾기
      const currentItem = filteredData.find(item => item.id === id);
      const currentValue = currentItem ? currentItem[field as keyof ItemData] : null;
      
      // 값이 실제로 변경된 경우에만 처리
      const valueChanged = numValue !== currentValue;
      
      if (valueChanged) {
        // 데이터 업데이트
        const updatedData = filteredData.map(item => 
          item.id === id ? { ...item, [field]: numValue } : item
        );
        
        setFilteredData(updatedData);
        
        // 전체 데이터도 업데이트
        const updatedItemData = itemData.map(item => 
          item.id === id ? { ...item, [field]: numValue } : item
        );
        
        setItemData(updatedItemData);
        
        // 변경된 항목 찾기
        const updatedItem = updatedData.find(item => item.id === id);
        
        // 수정된 데이터 추적
        if (updatedItem && updatedItem.row_id) {
          const rowKey = updatedItem.row_id;
          setModifiedData(prev => ({
            ...prev,
            [rowKey]: {
              ...(prev[rowKey] || {}),
              [field]: numValue
            }
          }));
        }
      }
      
      setEditingCell(null);
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
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      finishEditingCell();
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
  const saveToCache = (coupangName: string, data: ItemData[]) => {
    try {
      const cacheKey = `sheet_data_${coupangName}`;
      const cacheData = {
        data: data,
        timestamp: Date.now(),
        coupangName: coupangName
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

  // 검색 함수
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      const sortedData = sortData(itemData, sortType);
      setFilteredData(sortedData); // 검색어가 없으면 모든 데이터 표시 (정렬 적용)
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
      return;
    }

    try {
      setLoading(true);
      
      // 검색 타입에 따라 다른 API 호출
      let apiUrl = '';
      if (searchType === '배송번호') {
        apiUrl = `/api/search-by-delivery-number?term=${encodeURIComponent(searchTerm)}`;
      } else if (searchType === '일반검색') {
        apiUrl = `/api/search-general?term=${encodeURIComponent(searchTerm)}`;
      }
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('검색 중 오류가 발생했습니다.');
      }
      
      const result = await response.json();
      
      if (result.success) {
        const sortedData = sortData(result.data || [], sortType);
        setFilteredData(sortedData);
      } else {
        console.error('검색 오류:', result.error);
        alert(result.error || '검색 중 오류가 발생했습니다.');
        setFilteredData([]);
      }
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
      
      // 최적화된 API 엔드포인트 사용 - 캐시 비활성화
      const response = await fetch(`/api/load-google-sheet-optimized?googlesheet_id=${selectedUser.googlesheet_id}&cache=false`, {
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
        
        // 데이터를 캐시에 저장
        saveToCache(selectedCoupangUser, result.data || []);
        
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

  const handleItemClick = (item: ItemData) => {
    setSelectedItem(item);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedItem(null);
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
    
    // 초기 수량 설정 (기본값 1)
    const initialQuantities: { [key: string]: number } = {};
    itemsWithBarcode.forEach(item => {
      initialQuantities[item.id] = 1;
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

  // 수량 입력 후 JSON 저장
  const handleQuantityConfirm = async () => {
    // 바코드 데이터 준비 (수량 포함)
    const barcodeData: Array<{name: string, barcode: string, qty: number}> = [];
    
    Object.entries(productQuantities).forEach(([id, quantity]) => {
      const item = filteredData.find(item => item.id === id);
      if (item && item.barcode) {
        barcodeData.push({
          name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
          barcode: item.barcode,
          qty: quantity
        });
      }
    });
    
    if (barcodeData.length > 0) {
      const jsonContent = JSON.stringify(barcodeData, null, 2);
      
      // File System Access API 지원 여부 확인
      console.log('File System Access API 지원:', 'showSaveFilePicker' in window);
      
      if ('showSaveFilePicker' in window) {
        try {
          console.log('파일 저장 다이얼로그 열기 시도...');
          
          // 사용자가 저장 위치를 선택할 수 있는 다이얼로그 표시
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: 'barcode.json',
            types: [{
              description: 'JSON 파일',
              accept: { 'application/json': ['.json'] },
            }],
          });
          
          console.log('파일 핸들 획득:', handle);
          
          // 파일 쓰기
          const writable = await handle.createWritable();
          await writable.write(jsonContent);
          await writable.close();
          
          console.log('파일 저장 완료');
          alert(`바코드 데이터가 저장되었습니다.\n저장된 아이템: ${barcodeData.length}개`);
          
          setShowQuantityDialog(false);
          setProductQuantities({});
          setIsAllChecked(false);
          setSelectedRows(new Set());
        } catch (error) {
          console.error('파일 저장 오류:', error);
          console.error('오류 이름:', (error as Error).name);
          console.error('오류 메시지:', (error as Error).message);
          
          // 사용자가 취소한 경우가 아니면 폴백 사용
          if ((error as Error).name !== 'AbortError') {
            console.log('폴백 다운로드 사용');
            fallbackDownload(jsonContent, barcodeData.length);
            
            setShowQuantityDialog(false);
            setProductQuantities({});
            setSelectedRows(new Set());
          }
        }
      } else {
        console.log('File System Access API 미지원 - 폴백 사용');
        // File System Access API를 지원하지 않는 브라우저의 경우 기본 다운로드 사용
        fallbackDownload(jsonContent, barcodeData.length);
        
        setShowQuantityDialog(false);
        setProductQuantities({});
        setIsAllChecked(false);
        setSelectedRows(new Set());
      }
    }
  };

  // 저장 버튼 클릭 핸들러
  const handleSaveClick = async () => {
    if (Object.keys(modifiedData).length === 0) return;
    
    setIsSaving(true);
    console.log('저장 시작, 수정된 데이터:', modifiedData);
    
    try {
      // 수정된 모든 데이터에 대해 API 호출
      const savePromises = Object.entries(modifiedData).map(async ([id, fields]) => {
        const item = itemData.find(item => item.id === id);
        if (!item) {
          console.error('아이템을 찾을 수 없음:', id);
          return null;
        }
        
        // id가 row_id 값의 문자열이므로 row_id를 직접 사용
        const rowId = id;
        if (!rowId) {
          console.error('유효하지 않은 행 번호:', id);
          return { id, error: '유효하지 않은 행 번호입니다.' };
        }
        
        console.log(`아이템 ${id} 저장 중, 행 번호: ${rowId}, 필드:`, fields);
        
        const results = await Promise.all(
          Object.entries(fields).map(async ([field, value]) => {
            try {
              const requestBody = {
                row_id: rowId,
                field,
                value
              };
              
              console.log('API 요청 데이터:', requestBody);
              
              const response = await fetch('/api/save-cell-value', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
              });
              
              console.log(`${field} API 응답 상태:`, response.status, response.statusText);
              
              if (!response.ok) {
                const errorData = await response.json();
                console.error(`${field} 저장 실패:`, errorData);
                return { success: false, field, error: errorData };
              }
              
              const responseData = await response.json();
              console.log(`${field} 저장 성공:`, responseData);
              
              return { success: true, field, data: responseData };
            } catch (error) {
              console.error(`${field} 저장 오류:`, error);
              return { success: false, field, error };
            }
          })
        );
        
        return { id, results };
      });
      
      const results = await Promise.all(savePromises);
      console.log('모든 저장 작업 완료:', results);
      
      // 저장 완료 후 수정 데이터 초기화
      setModifiedData({});
      
      // 오류가 있는 경우 확인
      const hasErrors = results.some(result => 
        result && result.results && result.results.some((r: any) => !r.success)
      );
      
      if (hasErrors) {
        alert('일부 데이터 저장 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
      } else {
        alert('모든 변경사항이 저장되었습니다.');
      }
      
    } catch (error) {
      console.error('저장 중 오류 발생:', error);
      alert('일부 데이터 저장 중 오류가 발생했습니다.');
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
                          <span 
                            className="order-number-text"
                            onClick={() => handleItemClick(item)}
                          >
                            {item.order_number_prefix || ''}
                            {item.order_number_prefix && item.order_number && <br />}
                            {item.order_number || ''}
                          </span>
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
                          <div className="cost-display">
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
                        <td className="qty-cell">
                          {item.import_qty && (
                            <span className="qty-badge import-qty">
                              {item.import_qty}
                            </span>
                          )}
                        </td>
                        <td className="qty-cell">
                          {item.cancel_qty && (
                            <span className="qty-badge cancel-qty">
                              {item.cancel_qty}
                            </span>
                          )}
                        </td>
                        <td className="qty-cell">
                          {item.export_qty && (
                            <span className="qty-badge export-qty">
                              {item.export_qty}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="note-display">
                            {item.note || ''}
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

      {/* Drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={closeDrawer}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <h2>상품 상세 정보</h2>
              <button className="close-btn" onClick={closeDrawer}>×</button>
            </div>
            <div className="drawer-content">
              {selectedItem && (
                <div>
                  <h3>주문번호: {selectedItem.order_number}</h3>
                  <table className="detail-table">
                    <thead>
                      <tr>
                        <th>상품명</th>
                        <th>주문수량</th>
                        <th>단가</th>
                        <th>총금액</th>
                        <th>입고수량</th>
                        <th>카테고리</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="product-name-display">
                            {selectedItem.product_name}
                          </div>
                        </td>
                        <td>{selectedItem.order_qty || 0}</td>
                        <td>{selectedItem.unit_price?.toLocaleString() || 0}</td>
                        <td>
                          {selectedItem.total_price?.toLocaleString() || 0}
                        </td>
                        <td>
                          <input
                            type="number"
                            className="received-input"
                            defaultValue={selectedItem.received_qty || ''}
                          />
                        </td>
                        <td>
                          <select 
                            className="category-select"
                            defaultValue={selectedItem.category || ''}
                          >
                            <option value="">선택</option>
                            <option value="vest">vest</option>
                            <option value="blouse">blouse</option>
                            <option value="cardigan">cardigan</option>
                            <option value="hat">hat</option>
                            <option value="jacket">jacket</option>
                            <option value="night wear">night wear</option>
                            <option value="one piece">one piece</option>
                            <option value="scarf">scarf</option>
                            <option value="shorts">shorts</option>
                            <option value="skirt">skirt</option>
                            <option value="slippers">slippers</option>
                            <option value="t-shirt">t-shirt</option>
                          </select>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  
                  <div className="drawer-actions">
                    <button className="save-btn">저장</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
                            <div>{item.product_name} {item.product_name_sub}</div>
                            <div className="china-options">
                              {item.china_option1} {item.china_option2}
                            </div>
                            <div style={{fontSize: '12px', color: '#666', marginTop: '4px'}}>
                              바코드: {item.barcode}
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={productQuantities[item.id] || 1}
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
              <button className="confirm-btn" onClick={handleQuantityConfirm}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ItemCheck; 