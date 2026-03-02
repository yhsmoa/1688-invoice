'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/* V2 전용 - 공유 컴포넌트 (경로 유지) */
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import SearchForm from '../../component/SearchForm';
import ProcessReadyModal from '../../component/ProcessReadyModal';

/* V2 전용 - 로컬 컴포넌트 (경로 유지) */
import StatusCard from './StatusCard';
import './ItemCheck.css';

/* V2 전용 - hooks 경로 변경: V1에서 가져옴 */
import {
  useItemData,
  usePagination,
  useSearch,
  useEditCell,
  useBarcodeDialog,
  type ItemData,
  type ReadyItem
} from '../import-product/hooks';

/* V2 전용 - utils 경로 변경: V1에서 가져옴 */
import { loadGoogleSheetData, saveToCache } from '../import-product/utils/sheetLoader';
import { hasValueChanged } from '../import-product/utils/dataComparison';

/* V2 전용 - 테이블 컴포넌트 (경로 유지) */
import ItemTable from './components/ItemTable';
import ControlBar from './components/ControlBar';
import SearchSection from './components/SearchSection';

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
  // Custom hooks 초기화
  const {
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
  } = useItemData();

  const [filteredData, setFilteredData] = useState<ItemData[]>([]);

  const {
    currentPage,
    setCurrentPage,
    paginatedData,
    totalPages,
    handlePageChange,
    goToNextPage,
    goToPrevPage
  } = usePagination(filteredData, 20);

  const {
    searchTerm,
    setSearchTerm,
    searchType,
    setSearchType,
    performSearch: performSearchHook,
    searchDeliveryInfo: searchDeliveryInfoHook,
    searchBy1688OrderId: searchBy1688OrderIdHook,
    parseOrderInfoAndSearch: parseOrderInfoAndSearchHook
  } = useSearch(itemData, deliveryInfoData, orders1688Data);

  const {
    editingCell,
    cellValue,
    setCellValue,
    modifiedData,
    setModifiedData,
    readyItems,
    setReadyItems,
    startEditingCell,
    finishEditingCell,
    handleCellValueChange,
    handleCellKeyDown
  } = useEditCell(filteredData, setFilteredData, itemData, setItemData, paginatedData, originalData);

  const {
    showQuantityDialog,
    setShowQuantityDialog,
    productQuantities,
    setProductQuantities,
    isSavingLabel,
    setIsSavingLabel,
    labelFormulaType,
    setLabelFormulaType,
    handleBarcodeClick: handleBarcodeClickHook,
    handleBarcodeDBClick: handleBarcodeDBClickHook,
    handleQuantityConfirm: handleQuantityConfirmHook
  } = useBarcodeDialog();

  // 기타 상태 관리
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [activeStatus, setActiveStatus] = useState<string>(t('importProduct.statusCards.all'));
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{[key: string]: string}>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string, user_code?: string}[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');

  // 담당자(operator) 선택
  const OPERATOR_OPTIONS = ['소현', '장뢰', '3'];
  const OPERATOR_ID_MAP: { [key: string]: number } = { '소현': 1, '장뢰': 2, '3': 3 };
  const [selectedOperator, setSelectedOperator] = useState<string>('');
  const [isLoadingFromCache, setIsLoadingFromCache] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sortType, setSortType] = useState<string>('주문순서');
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [isProcessReadyModalOpen, setIsProcessReadyModalOpen] = useState(false);
  const [originalFieldValues, setOriginalFieldValues] = useState<{[itemId: string]: {import_qty: number | null, cancel_qty: number | null, note: string | null}}>({});
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const excelFileInputRef = useRef<HTMLInputElement>(null);

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

  // Cell editing functions are now provided by useEditCell hook

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
    fetchAll1688Orders(); // invoiceManager_1688_orders 데이터 로딩
  }, []);

  // 드롭다운 선택 시 구글 시트 데이터 자동 로드
  useEffect(() => {
    if (selectedCoupangUser && !isLoadingFromCache) {
      handleLoadGoogleSheet();
    }
  }, [selectedCoupangUser]);


  // 쿠팡 사용자 목록 가져오기
  const fetchCoupangUsers = async () => {
    try {
      console.log('쿠팡 사용자 목록 가져오기 시작...');
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      console.log('API 응답:', result);

      if (result.success && result.data) {
        console.log('쿠팡 사용자 데이터:', result.data);
        setCoupangUsers(result.data);
      } else {
        console.warn('쿠팡 사용자 데이터를 가져오지 못했습니다:', result);
      }
    } catch (error) {
      console.error('쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  // Pagination and delivery functions are provided by hooks
  // searchDeliveryInfo and parseOrderInfoAndSearch are now provided by useSearch hook

  // 상태별 필터링 함수
  const filterByStatus = (data: ItemData[], status: string): ItemData[] => {
    console.log('filterByStatus 호출 - 상태:', status, '전체 데이터:', data.length);

    if (status === '전체') {
      return data;
    } else if (status === '발송전') {
      const filtered = data.filter(item => {
        const deliveryStatus = item.delivery_status;
        const isMatch = deliveryStatus === '等待卖家发货' || !deliveryStatus || deliveryStatus.trim() === '';

        return isMatch;
      });

      console.log('발송전 필터링 결과:', filtered.length, '개');
      return filtered;
    }
    // 나머지 상태는 아직 구현하지 않음
    return data;
  };

  // 검색 함수 - Hook에서 가져온 함수 사용
  const performSearch = async () => {
    // 검색 시 처리준비 데이터 초기화
    setReadyItems([]);
    setModifiedData({});
    // 검색 시 체크박스 선택 초기화
    setSelectedRows(new Set());

    await performSearchHook(
      activeStatus,
      sortType,
      sortData,
      filterByStatus,
      setLoading,
      setFilteredData,
      setCurrentPage
    );
  };

  // 검색어 변경 시 자동으로 필터링하지 않음 (메모리 효율성을 위해)
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // 검색 타입 변경 시 검색어 초기화 및 전체 데이터 표시
  const handleSearchTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchType(e.target.value);
    setSearchTerm(''); // 검색어 초기화

    // 처리준비 데이터 초기화
    setReadyItems([]);
    setModifiedData({});
    // 체크박스 선택 초기화
    setSelectedRows(new Set());

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

    // 처리준비 데이터 초기화
    setReadyItems([]);
    setModifiedData({});
    // 체크박스 선택 초기화
    setSelectedRows(new Set());

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

      // 구글 시트 데이터 로드 (유틸리티 함수 사용)
      const result = await loadGoogleSheetData({
        googlesheetId: selectedUser.googlesheet_id,
        coupangName: selectedCoupangUser
      });

      if (result.success && result.data) {
        // 배송정보 매핑 적용
        const dataWithDeliveryInfo = mapDeliveryInfoToItems(result.data);

        // 현재 활성화된 상태에 따라 필터링
        const filteredByStatus = filterByStatus(dataWithDeliveryInfo, activeStatus);

        // 구글 시트 데이터를 테이블에 직접 표시
        const sortedData = sortData(filteredByStatus, sortType);
        setOriginalData(dataWithDeliveryInfo);
        setItemData(dataWithDeliveryInfo);
        setFilteredData(sortedData);

        // 데이터를 캐시에 저장 (구글시트 ID 포함)
        saveToCache(selectedCoupangUser, dataWithDeliveryInfo, selectedUser.googlesheet_id);

        // 처리준비 목록 초기화
        setReadyItems([]);
        setModifiedData({});

        setLoading(false);
        setIsLoadingFromCache(false); // 플래그 해제

        // 로드 시간 정보 포함
        const loadTimeInfo = result.loadTime ? ` (${(result.loadTime / 1000).toFixed(1)}초)` : '';
        alert(`${result.message}${loadTimeInfo}`);
      } else {
        console.error('구글 시트 API 오류:', result.error);
        alert(result.error || '구글 시트 데이터를 불러오는데 실패했습니다.');
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

  // 배송누락 버튼 클릭 핸들러 (토글 방식)
  const handleBarcodeDBClick = async () => {
    if (selectedRows.size === 0) {
      return;
    }

    // 선택된 항목 필터링
    const selectedItems = filteredData.filter(item => selectedRows.has(item.id));

    // 배송누락 마커 텍스트
    const missingMarkers = ['😈 没有库存-미입고', '😠 库存短缺-입고부족'];

    // 추가할 항목과 제거할 항목 분류
    const itemsToAdd: Array<{
      id: string;
      currentNote: string;
      newNote: string;
    }> = [];

    const itemsToRemove: Array<{
      id: string;
      currentNote: string;
      newNote: string;
    }> = [];

    selectedItems.forEach(item => {
      const progressQty = parseInt(item.progress_qty?.toString() || '0');
      const importQty = parseInt(item.import_qty?.toString() || '0');

      if (progressQty > importQty) {
        const currentNote = item.note || '';

        // 이미 배송누락 마커가 있는지 확인
        const hasMarker = missingMarkers.some(marker => currentNote.includes(marker));

        if (hasMarker) {
          // 제거: 모든 배송누락 마커 삭제
          let newNote = currentNote;
          missingMarkers.forEach(marker => {
            newNote = newNote.split('\n').filter(line => !line.includes(marker)).join('\n').trim();
          });

          itemsToRemove.push({
            id: item.id,
            currentNote: currentNote,
            newNote: newNote
          });
        } else {
          // 추가: 배송누락 마커 추가
          let missingText = '';
          if (importQty === 0) {
            missingText = '😈 没有库存-미입고';
          } else {
            missingText = '😠 库存短缺-입고부족';
          }

          const newNote = currentNote ? `${currentNote}\n${missingText}` : missingText;

          itemsToAdd.push({
            id: item.id,
            currentNote: currentNote,
            newNote: newNote
          });
        }
      }
    });

    // 업데이트할 항목이 없으면 종료
    if (itemsToAdd.length === 0 && itemsToRemove.length === 0) {
      return;
    }

    try {
      // modifiedData 업데이트
      const newModifiedData = { ...modifiedData };

      [...itemsToAdd, ...itemsToRemove].forEach(updateItem => {
        const item = filteredData.find(i => i.id === updateItem.id);
        if (item && item.order_number && item.barcode) {
          const itemKey = `${item.order_number}|${item.barcode}`;
          if (!newModifiedData[itemKey]) {
            newModifiedData[itemKey] = {};
          }
          newModifiedData[itemKey].note = updateItem.newNote;
        }
      });
      setModifiedData(newModifiedData);

      // filteredData와 itemData 업데이트
      const updateDataNote = (data: ItemData[]) => {
        return data.map(item => {
          const updateItem = [...itemsToAdd, ...itemsToRemove].find(u => u.id === item.id);
          if (updateItem) {
            return { ...item, note: updateItem.newNote };
          }
          return item;
        });
      };

      setFilteredData(updateDataNote(filteredData));
      setItemData(updateDataNote(itemData));

      // readyItems 업데이트 (처리준비 목록에 추가)
      [...itemsToAdd, ...itemsToRemove].forEach(updateItem => {
        const item = filteredData.find(i => i.id === updateItem.id);
        if (item && item.order_number && item.barcode) {
          // 원본 데이터에서 원본 입고 수량 가져오기
          const originalItem = originalData.find(i => i.id === item.id);
          const originalImportQty = originalItem?.import_qty ?? null;

          console.log('=== 배송누락 처리준비 추가 디버깅 ===');
          console.log('항목 ID:', item.id);
          console.log('원본 note:', originalItem?.note);
          console.log('새로운 note:', updateItem.newNote);

          // 원본과 비교하여 변경되었는지 확인
          const isChangedFromOriginal = hasValueChanged(
            originalData,
            item.id,
            'note',
            updateItem.newNote
          );

          console.log('isChangedFromOriginal:', isChangedFromOriginal);

          if (isChangedFromOriginal) {
            setReadyItems(prev => {
              const existingIndex = prev.findIndex(ri => ri.id === item.id);

              const readyItem: ReadyItem = {
                id: item.id,
                img_url: item.img_url || null,
                order_number: item.order_number,
                barcode: item.barcode || '',
                product_name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
                order_option: `${item.china_option1 || ''}${item.china_option1 && item.china_option2 ? ' ' : ''}${item.china_option2 || ''}`.trim(),
                progress: item.progress_qty?.toString() || null,
                import_qty: item.import_qty ?? null,
                cancel_qty: item.cancel_qty ?? null,
                memo: updateItem.newNote || null,
                barcode_qty: 0, // 배송누락은 바코드 수량 0
                original_import_qty: originalImportQty,
                modifiedFields: {
                  ...(existingIndex >= 0 ? prev[existingIndex].modifiedFields : {}),
                  note: updateItem.newNote
                }
              };

              if (existingIndex >= 0) {
                const newItems = [...prev];
                newItems[existingIndex] = readyItem;
                return newItems;
              } else {
                return [...prev, readyItem];
              }
            });
          } else {
            // 원본과 같아졌으면 처리준비 목록에서 제거
            setReadyItems(prev => prev.filter(ri => ri.id !== item.id));
          }
        }
      });

    } catch (error) {
      console.error('배송누락 표시 중 오류:', error);
    }
  };

  // 기존 바코드 DB 저장 함수 (참고용)
  const handleBarcodeDBClickOld = async () => {
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
      setIsSavingLabel(false);
      return;
    }

    let googlesheetId;
    try {
      const parsedCache = JSON.parse(cachedData);
      googlesheetId = parsedCache.googlesheet_id;
    } catch (error) {
      console.error('캐시 파싱 오류:', error);
      alert('구글시트 정보를 가져올 수 없습니다.');
      setIsSavingLabel(false);
      return;
    }

    if (!googlesheetId) {
      alert('구글시트 ID를 찾을 수 없습니다. 다시 시트를 불러와주세요.');
      setIsSavingLabel(false);
      return;
    }

    // 사용자가 '설온'인지 확인
    const isSeolOn = selectedCoupangUser === '설온';

    // 주문번호에서 세번째 '-' 이후 제거 (BZ-260120-0045-A01 → BZ-260120-0045)
    const truncateOrderNumber = (orderNum: string): string => {
      if (!orderNum) return '';
      const parts = orderNum.split('-');
      return parts.slice(0, 3).join('-');
    };

    // 바코드 데이터 준비 및 시트별 분류
    interface LabelDataItem {
      name: string;
      barcode: string;
      qty: number;
      order_number: string;
      sizeCode: string;
      targetSheet: 'LABEL' | 'LABEL_kids';
    }

    // 바코드 정규화 함수 (주문번호 형태인 경우만 정규화: BZ-260123-0006-S21 → BZ-260123-0006)
    const normalizeBarcode = (barcode: string): string => {
      if (!barcode) return '';
      // 주문번호 형태인지 확인 (XX-XXXXXX-XXXX 패턴)
      const parts = barcode.split('-');
      if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[0]) && /^\d{6}$/.test(parts[1])) {
        // 주문번호 형태이면 세번째 '-' 이후 제거
        return parts.slice(0, 3).join('-');
      }
      // 일반 바코드는 그대로 반환
      return barcode;
    };

    const labelDataWithTarget: LabelDataItem[] = [];

    Object.entries(productQuantities).forEach(([id, quantity]) => {
      const item = filteredData.find(item => item.id === id);
      if (item && item.barcode) {
        // 주문번호 정리: 세번째 '-' 이후 제거
        const orderNumber = truncateOrderNumber(item.order_number || '');

        // H열용 사이즈 코드 결정 (주문번호에 추가하지 않고 별도 저장)
        let sizeCode = '';
        if (item.product_size && typeof item.product_size === 'string' && item.product_size.trim()) {
          const sizeText = item.product_size.trim();
          const sizeLower = sizeText.toLowerCase();

          if (sizeLower.includes('small')) {
            sizeCode = 'A';
          } else if (sizeLower.includes('medium')) {
            sizeCode = 'B';
          } else if (sizeLower.includes('large')) {
            sizeCode = 'C';
          } else if (sizeLower.includes('p-')) {
            sizeCode = 'P';
          } else if (sizeLower.includes('direct')) {
            sizeCode = 'X';
          }
        }

        // 시트 선택 로직: 설온 + X열에 데이터 있음 → LABEL_kids, 그 외 → LABEL
        const hasRecommendedAge = item.recommended_age &&
                                   typeof item.recommended_age === 'string' &&
                                   item.recommended_age.trim() !== '';

        const targetSheet = (isSeolOn && hasRecommendedAge) ? 'LABEL_kids' : 'LABEL';

        labelDataWithTarget.push({
          name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
          barcode: normalizeBarcode(item.barcode),
          qty: quantity,
          order_number: orderNumber,
          sizeCode: sizeCode,
          targetSheet: targetSheet
        });
      }
    });

    if (labelDataWithTarget.length === 0) {
      alert('저장할 바코드 데이터가 없습니다.');
      setIsSavingLabel(false);
      return;
    }

    // 중복 주문번호 제거 (동일한 order_number는 하나만 유지)
    const uniqueLabelData: typeof labelDataWithTarget = [];
    const seenOrderNumbers = new Set<string>();

    labelDataWithTarget.forEach(item => {
      if (!seenOrderNumbers.has(item.order_number)) {
        seenOrderNumbers.add(item.order_number);
        uniqueLabelData.push(item);
      }
    });

    // 시트별로 데이터 그룹핑
    const labelSheetData = uniqueLabelData.filter(item => item.targetSheet === 'LABEL');
    const labelKidsSheetData = uniqueLabelData.filter(item => item.targetSheet === 'LABEL_kids');

    console.log(`LABEL 시트: ${labelSheetData.length}개, LABEL_kids 시트: ${labelKidsSheetData.length}개`);

    try {
      // 병렬 처리로 여러 시트 동시 저장
      const savePromises = [];

      if (labelSheetData.length > 0) {
        console.log('LABEL 시트에 데이터 저장 시작...');
        savePromises.push(
          fetch('/api/save-label-data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              labelData: labelSheetData,
              googlesheet_id: googlesheetId,
              coupang_name: selectedCoupangUser,
              targetSheet: 'LABEL',
              labelFormulaType: labelFormulaType || 'mixRate'
            }),
          }).then(async response => {
            const result = await response.json();
            if (!response.ok || !result.success) {
              throw new Error(`LABEL 시트 저장 실패: ${result.message || result.error || '알 수 없는 오류'}`);
            }
            console.log(`LABEL 시트에 바코드 ${result.count}개 저장 완료`);
            return result;
          })
        );
      }

      if (labelKidsSheetData.length > 0) {
        console.log('LABEL_kids 시트에 데이터 저장 시작...');
        savePromises.push(
          fetch('/api/save-label-data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              labelData: labelKidsSheetData,
              googlesheet_id: googlesheetId,
              coupang_name: selectedCoupangUser,
              targetSheet: 'LABEL_kids',
              labelFormulaType: labelFormulaType || 'mixRate'
            }),
          }).then(async response => {
            const result = await response.json();
            if (!response.ok || !result.success) {
              throw new Error(`LABEL_kids 시트 저장 실패: ${result.message || result.error || '알 수 없는 오류'}`);
            }
            console.log(`LABEL_kids 시트에 바코드 ${result.count}개 저장 완료`);
            return result;
          })
        );
      }

      // 병렬 실행 (속도 최적화)
      const results = await Promise.all(savePromises);

      // 성공 메시지
      const totalCount = results.reduce((sum, result) => sum + (result.count || 0), 0);
      let message = '바코드 데이터가 저장되었습니다.\n';
      if (labelSheetData.length > 0) {
        message += `LABEL: ${labelSheetData.length}개\n`;
      }
      if (labelKidsSheetData.length > 0) {
        message += `LABEL_kids: ${labelKidsSheetData.length}개\n`;
      }
      message += `총 ${totalCount}개 저장 완료`;

      alert(message);

      setShowQuantityDialog(false);
      setProductQuantities({});
      setSelectedRows(new Set());
      setLabelFormulaType('');  // 라디오 선택 초기화

    } catch (error) {
      console.error('LABEL 시트 저장 중 오류:', error);
      alert(error instanceof Error ? error.message : 'LABEL 시트 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingLabel(false);
    }
  };


  // ============================================================
  // PostgreSQL fashion_label 테이블 저장 핸들러
  // ============================================================
  const handleSaveToPostgre = async () => {
    // 필수 값 검증
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }
    if (!selectedOperator) {
      alert('담당자를 선택해주세요.');
      return;
    }

    setIsSavingLabel(true);

    try {
      // 다이얼로그 아이템 데이터 구성
      const items = Object.entries(productQuantities).map(([id, quantity]) => {
        const item = filteredData.find(d => d.id === id);
        if (!item || !item.barcode) return null;

        return {
          brand: selectedCoupangUser,
          item_name: `${item.product_name || ''}${item.product_name && item.product_name_sub ? ', ' : ''}${item.product_name_sub || ''}`.trim(),
          barcode: item.barcode,
          qty: quantity,
          order_no: item.order_number || '',
          composition: item.fabric_blend || null,
          recommanded_age: item.recommended_age || null,
          shipment_size: item.product_size || null,
          user_id: OPERATOR_ID_MAP[selectedOperator] || null,
        };
      }).filter(Boolean);

      if (items.length === 0) {
        alert('저장할 데이터가 없습니다.');
        setIsSavingLabel(false);
        return;
      }

      console.log('fashion_label 저장 요청:', items);

      // API 호출 (user_id를 최상위에 전달하여 기존 데이터 삭제 기준으로 사용)
      const operatorId = OPERATOR_ID_MAP[selectedOperator] || null;
      const response = await fetch('/api/save-fashion-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, user_id: operatorId }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(`PostgreSQL 저장 완료: ${result.count}개`);
        setShowQuantityDialog(false);
        setProductQuantities({});
        setSelectedRows(new Set());
        setLabelFormulaType('');
      } else {
        console.error('fashion_label 저장 실패:', result);
        alert(`저장 실패: ${result.error || '알 수 없는 오류'}`);
      }
    } catch (error) {
      console.error('fashion_label 저장 오류:', error);
      alert('PostgreSQL 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingLabel(false);
    }
  };

  // 바코드 수량 변경 핸들러
  const handleBarcodeQtyChange = (itemId: string, newQty: number) => {
    setReadyItems(prev =>
      prev.map(item =>
        item.id === itemId ? { ...item, barcode_qty: newQty } : item
      )
    );
  };

  // 처리준비 모달에서 저장 버튼 클릭 핸들러
  const handleReadySave = async (formulaType: string = 'mixRate') => {
    console.log('=== handleReadySave 시작 ===');
    console.log('modifiedData:', modifiedData);
    console.log('readyItems 개수:', readyItems.length);
    console.log('labelFormulaType:', formulaType);

    try {
      // 1. 구글 시트 저장
      await handleSaveClick();

      // 2. LABEL 시트에 바코드 데이터 저장
      await saveBarcodeToLabel(formulaType);

      console.log('저장 완료, 처리준비 목록 초기화');

      // 3. 처리준비 목록 초기화
      setReadyItems([]);
      setModifiedData({});

      // 4. 모달 닫기
      setIsProcessReadyModalOpen(false);

      console.log('=== handleReadySave 완료 ===');
    } catch (error) {
      console.error('처리준비 저장 오류:', error);
      alert('저장 중 오류가 발생했습니다.');
    }
  };

  // ============================================================
  // 처리준비 모달 → PostgreSQL 저장 핸들러
  // ============================================================
  const handleReadySavePostgre = async () => {
    console.log('=== handleReadySavePostgre 시작 ===');

    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }
    if (!selectedOperator) {
      alert('담당자를 선택해주세요.');
      return;
    }

    try {
      // 1. 구글 시트 저장 (기존 로직 유지)
      await handleSaveClick();

      // 2. PostgreSQL fashion_label 저장 (readyItems 기반)
      const itemsWithBarcode = readyItems.filter(item => item.barcode && item.barcode_qty > 0);

      if (itemsWithBarcode.length > 0) {
        const items = itemsWithBarcode.map(item => {
          // filteredData에서 원본 ItemData 조회 (fabric_blend, product_size, recommended_age)
          const originalItem = itemData.find(d => d.id === item.id);

          return {
            brand: selectedCoupangUser,
            item_name: item.product_name || '',
            barcode: item.barcode,
            qty: item.barcode_qty,
            order_no: item.order_number || '',
            composition: originalItem?.fabric_blend || null,
            recommanded_age: originalItem?.recommended_age || null,
            shipment_size: originalItem?.product_size || null,
            user_id: OPERATOR_ID_MAP[selectedOperator] || null,
          };
        });

        const operatorId = OPERATOR_ID_MAP[selectedOperator] || null;
        const response = await fetch('/api/save-fashion-label', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, user_id: operatorId }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || 'PostgreSQL 저장 실패');
        }
        console.log(`PostgreSQL 저장 완료: ${result.count}개`);
      }

      // 3. 처리준비 목록 초기화 + 모달 닫기
      setReadyItems([]);
      setModifiedData({});
      setIsProcessReadyModalOpen(false);

      alert('PostgreSQL 저장이 완료되었습니다.');
      console.log('=== handleReadySavePostgre 완료 ===');
    } catch (error) {
      console.error('처리준비 PostgreSQL 저장 오류:', error);
      alert(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
    }
  };

  // LABEL 시트에 바코드 데이터 저장
  const saveBarcodeToLabel = async (formulaType: string = 'mixRate') => {
    // 바코드 수량이 0보다 큰 항목만 필터링
    const itemsWithBarcode = readyItems.filter(item => item.barcode && item.barcode_qty > 0);

    if (itemsWithBarcode.length === 0) {
      console.log('바코드 저장할 항목 없음');
      return;
    }

    // 현재 선택된 사용자의 구글시트 정보 확인
    if (!selectedCoupangUser) {
      throw new Error('쿠팡 사용자를 선택해주세요.');
    }

    // localStorage에서 구글시트 ID 가져오기
    const cacheKey = `sheet_data_${selectedCoupangUser}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (!cachedData) {
      throw new Error('구글시트 데이터를 먼저 불러와주세요.');
    }

    let googlesheetId;
    try {
      const parsedCache = JSON.parse(cachedData);
      googlesheetId = parsedCache.googlesheet_id;
    } catch (error) {
      console.error('캐시 파싱 오류:', error);
      throw new Error('구글시트 정보를 가져올 수 없습니다.');
    }

    if (!googlesheetId) {
      throw new Error('구글시트 ID를 찾을 수 없습니다.');
    }

    // 사용자가 '설온'인지 확인
    const isSeolOn = selectedCoupangUser === '설온';

    // 바코드 데이터 준비 및 시트별 분류
    interface LabelDataItem {
      name: string;
      barcode: string;
      qty: number;
      order_number: string;
      sizeCode: string;  // H열: 사이즈 코드 (A, B, C, P, X)
      targetSheet: 'LABEL' | 'LABEL_kids';
    }

    // 주문번호에서 세번째 '-' 이후 제거 (BZ-260120-0045-A01 → BZ-260120-0045)
    const truncateOrderNumber = (orderNum: string): string => {
      if (!orderNum) return '';
      const parts = orderNum.split('-');
      // 첫 3개 부분만 유지 (사업자코드-날짜-순서)
      return parts.slice(0, 3).join('-');
    };

    const labelDataWithTarget: LabelDataItem[] = [];

    itemsWithBarcode.forEach(item => {
      if (item.barcode && item.barcode_qty > 0) {
        // 원본 데이터에서 product_size와 recommended_age 가져오기
        const originalItem = itemData.find(dataItem => dataItem.id === item.id);

        // 주문번호 정리: 세번째 '-' 이후 제거
        const orderNumber = truncateOrderNumber(item.order_number || '');

        // H열용 사이즈 코드 결정 (주문번호에 추가하지 않고 별도 저장)
        let sizeCode = '';
        if (originalItem?.product_size && typeof originalItem.product_size === 'string' && originalItem.product_size.trim()) {
          const sizeText = originalItem.product_size.trim();
          const sizeLower = sizeText.toLowerCase();

          if (sizeLower.includes('small')) {
            sizeCode = 'A';
          } else if (sizeLower.includes('medium')) {
            sizeCode = 'B';
          } else if (sizeLower.includes('large')) {
            sizeCode = 'C';
          } else if (sizeLower.includes('p-')) {
            sizeCode = 'P';
          } else if (sizeLower.includes('direct')) {
            sizeCode = 'X';
          }
        }

        // 시트 선택 로직: 설온 + X열에 데이터 있음 → LABEL_kids, 그 외 → LABEL
        const hasRecommendedAge = originalItem?.recommended_age &&
                                   typeof originalItem.recommended_age === 'string' &&
                                   originalItem.recommended_age.trim() !== '';

        const targetSheet = (isSeolOn && hasRecommendedAge) ? 'LABEL_kids' : 'LABEL';

        labelDataWithTarget.push({
          name: item.product_name,
          barcode: item.barcode,
          qty: item.barcode_qty,
          order_number: orderNumber,
          sizeCode: sizeCode,
          targetSheet: targetSheet
        });
      }
    });

    // 중복 주문번호 제거 (동일한 order_number는 하나만 유지)
    const uniqueLabelData: LabelDataItem[] = [];
    const seenOrderNumbers = new Set<string>();

    labelDataWithTarget.forEach(item => {
      // targetSheet + order_number 조합으로 중복 체크
      const uniqueKey = `${item.targetSheet}|${item.order_number}`;
      if (!seenOrderNumbers.has(uniqueKey)) {
        seenOrderNumbers.add(uniqueKey);
        uniqueLabelData.push(item);
      }
    });

    // 중복 제거된 데이터 사용
    const finalLabelData = uniqueLabelData;

    if (finalLabelData.length === 0) {
      console.log('저장할 라벨 데이터 없음');
      return;
    }

    // 시트별로 데이터 그룹핑 (중복 제거된 데이터 사용)
    const labelSheetData = finalLabelData.filter(item => item.targetSheet === 'LABEL');
    const labelKidsSheetData = finalLabelData.filter(item => item.targetSheet === 'LABEL_kids');

    console.log(`LABEL 시트: ${labelSheetData.length}개, LABEL_kids 시트: ${labelKidsSheetData.length}개`);

    // 병렬 처리로 여러 시트 동시 저장
    const savePromises = [];

    if (labelSheetData.length > 0) {
      console.log('LABEL 시트에 데이터 저장 시작...');
      savePromises.push(
        fetch('/api/save-label-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            labelData: labelSheetData,
            googlesheet_id: googlesheetId,
            coupang_name: selectedCoupangUser,
            targetSheet: 'LABEL',
            labelFormulaType: formulaType
          }),
        }).then(async response => {
          const result = await response.json();
          if (!response.ok || !result.success) {
            console.error('LABEL 시트 저장 실패:', result);
            throw new Error(result.message || result.error || 'LABEL 시트 저장 실패');
          }
          console.log(`LABEL 시트에 바코드 ${result.count}개 저장 완료`);
          return result;
        })
      );
    }

    if (labelKidsSheetData.length > 0) {
      console.log('LABEL_kids 시트에 데이터 저장 시작...');
      savePromises.push(
        fetch('/api/save-label-data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            labelData: labelKidsSheetData,
            googlesheet_id: googlesheetId,
            coupang_name: selectedCoupangUser,
            targetSheet: 'LABEL_kids',
            labelFormulaType: formulaType
          }),
        }).then(async response => {
          const result = await response.json();
          if (!response.ok || !result.success) {
            console.error('LABEL_kids 시트 저장 실패:', result);
            throw new Error(result.message || result.error || 'LABEL_kids 시트 저장 실패');
          }
          console.log(`LABEL_kids 시트에 바코드 ${result.count}개 저장 완료`);
          return result;
        })
      );
    }

    // 병렬 실행 (속도 최적화)
    await Promise.all(savePromises);
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
      const updates: Array<{ order_number: string; barcode: string; field: string; value: number | string | null }> = [];

      console.log('modifiedData 키 목록:', Object.keys(modifiedData));

      Object.entries(modifiedData).forEach(([itemKey, fields]) => {
        // itemKey는 "order_number|barcode" 형식
        const parts = itemKey.split('|');

        if (parts.length !== 2) {
          console.error('잘못된 itemKey 형식:', itemKey);
          return;
        }

        const [order_number, barcode] = parts;

        Object.entries(fields).forEach(([field, value]) => {
          console.log(`추가: ${order_number} | ${barcode} | ${field} = ${value}`);
          updates.push({ order_number, barcode, field, value });
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
                  rowId: item.rowNumber.toString(),
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
                alert(`저장 및 검증 완료!\n\n저장: ${successCount}개\n검증: ${verifyResult.details.matchCount}/${verifyResult.details.totalChecked}개 일치\n총 소요 시간: ${totalSaveTime}초\n검증 시간: ${verifyTime}초`);
              } else {
                // 일부 불일치
                const mismatches = verifyResult.details.mismatches || [];
                const mismatchInfo = mismatches.map((m: any) =>
                  `행 ${m.rowId} - ${m.field}: 예상값 "${m.expected}" != 실제값 "${m.actual}"`
                ).join('\n');

                alert(`저장되었으나 일부 데이터가 불일치합니다.\n\n일치: ${verifyResult.details.matchCount}개\n불일치: ${verifyResult.details.mismatchCount}개\n\n불일치 항목:\n${mismatchInfo}\n\n시트를 다시 불러와서 확인해주세요.`);

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
              alert(`저장은 완료되었으나 검증에 실패했습니다.\n\n저장 완료: ${successCount}개\n소요 시간: ${totalSaveTime}초\n\n검증 오류: ${verifyResult.error || '알 수 없는 오류'}\n\n시트를 새로고침하여 확인해주세요.`);
            }
          } catch (verifyError) {
            // 검증 중 예외 발생
            console.error('검증 중 오류:', verifyError);
            setModifiedData({}); // 일단 초기화
            alert(`저장은 완료되었으나 검증 중 오류가 발생했습니다.\n\n저장 완료: ${successCount}개\n소요 시간: ${totalSaveTime}초\n\n시트를 새로고침하여 확인해주세요.`);
          }
        } else {
          // 부분 성공
          const failedInfo = failedDetails?.map((f: any) => `행 ${f.rowId} - ${f.field}: ${f.error}`).join('\n') || '';
          alert(`일부 데이터가 저장되었습니다.\n\n성공: ${successCount}개\n실패: ${failedCount}개\n\n실패 항목:\n${failedInfo}`);

          // 성공한 항목들만 modifiedData에서 제거
          const newModifiedData = { ...modifiedData };
          successDetails?.forEach((item: any) => {
            // order_number와 barcode로 itemKey 생성
            const itemKey = `${item.order_number}|${item.barcode}`;

            if (newModifiedData[itemKey]) {
              delete newModifiedData[itemKey][item.field];

              // 해당 itemKey의 모든 필드가 저장되었으면 itemKey 자체를 삭제
              if (Object.keys(newModifiedData[itemKey]).length === 0) {
                delete newModifiedData[itemKey];
              }
            }
          });
          setModifiedData(newModifiedData);
        }
      } else {
        // 전체 실패
        console.error('배치 저장 실패:', result);
        alert(`데이터 저장에 실패했습니다.\n\n오류: ${result.error || result.details || '알 수 없는 오류'}\n\n네트워크 연결을 확인해주세요.`);
      }

    } catch (error) {
      console.error('저장 중 오류 발생:', error);
      alert(`데이터 저장 중 오류가 발생했습니다.\n\n${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // V2 전용 렌더링 - 모든 className에 v2- 접두사
  // ============================================================
  return (
    <div className="v2-item-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="v2-item-main-content">
        <LeftsideMenu />
        <main className="v2-item-content">
          <div className="v2-item-container">
            <h1 className="v2-item-title">{t('importProduct.title')}</h1>

            {/* 시트 불러오기 버튼 - 카드 위로 이동 */}
            <div className="v2-excel-upload-section">
              {/* 담당자(operator) 선택 드롭박스 */}
              <select
                className="v2-coupang-user-dropdown"
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
              >
                <option value="">{t('importProduct.selectOperator')}</option>
                {OPERATOR_OPTIONS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>

              {/* 쿠팡 사용자 선택 드롭박스 (담당자 선택 후 활성화) */}
              <select
                className="v2-coupang-user-dropdown"
                value={selectedCoupangUser}
                onChange={(e) => setSelectedCoupangUser(e.target.value)}
                disabled={!selectedOperator}
              >
                <option value="">{t('importProduct.selectUser')}</option>
                {coupangUsers.map((user) => {
                  // 캐시 데이터 확인
                  const cacheKey = `sheet_data_${user.coupang_name}`;
                  const hasCachedData = localStorage.getItem(cacheKey) !== null;

                  return (
                    <option key={user.coupang_name} value={user.coupang_name}>
                      {user.user_code ? `${user.user_code} ${user.coupang_name}` : user.coupang_name} {hasCachedData ? '●' : ''}
                    </option>
                  );
                })}
              </select>
              <button
                className="v2-excel-upload-btn"
                onClick={handleLoadGoogleSheet}
                disabled={loading || !selectedOperator || !selectedCoupangUser}
              >
                {loading ? (
                  <span className="v2-button-loading">
                    <span className="v2-spinner"></span>
                    {t('importProduct.refresh')}
                  </span>
                ) : (
                  t('importProduct.refresh')
                )}
              </button>
              <button
                className="v2-excel-upload-btn"
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
            <div className="v2-status-cards">
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

            {/* 정렬 옵션과 버튼들 - 검색 입력폼 위로 이동 */}
            <ControlBar
              sortType={sortType}
              readyItemsCount={readyItems.length}
              onSortTypeChange={handleSortTypeChange}
              onProcessReadyClick={() => setIsProcessReadyModalOpen(true)}
              onBarcodeClick={handleBarcodeClick}
              onBarcodeDBClick={handleBarcodeDBClick}
            />

            {/* 검색 영역 */}
            <SearchSection
              searchType={searchType}
              searchTerm={searchTerm}
              onSearchTypeChange={handleSearchTypeChange}
              onSearchInputChange={handleSearchInputChange}
              onSearchKeyPress={handleSearchKeyPress}
              onSearchClick={handleSearchClick}
            />

            {/* 테이블 */}
            <ItemTable
              loading={loading}
              paginatedData={paginatedData}
              selectedRows={selectedRows}
              editingCell={editingCell}
              cellValue={cellValue}
              mousePosition={mousePosition}
              isAllSelected={isAllSelected}
              isIndeterminate={isIndeterminate}
              onSelectAll={handleSelectAll}
              onSelectRow={handleSelectRow}
              onStartEditingCell={startEditingCell}
              onCellValueChange={handleCellValueChange}
              onHandleCellKeyDown={handleCellKeyDown}
              onFinishEditingCell={finishEditingCell}
              onSetCellValue={setCellValue}
              onCostClick={handleCostClick}
            />

            {/* 페이지네이션 */}
            {!loading && filteredData.length > 0 && (
              <div className="v2-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="v2-pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>

                <div className="v2-page-numbers">
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
                        className={`v2-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="v2-pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="v2-page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>


      {/* 수량 입력 다이얼로그 */}
      {showQuantityDialog && (
        <div className="v2-quantity-dialog-overlay" onClick={() => setShowQuantityDialog(false)}>
          <div className="v2-quantity-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="v2-quantity-dialog-header">
              <h2>{t('importProduct.dialog.quantityTitle')}</h2>
              <button className="v2-close-btn" onClick={() => setShowQuantityDialog(false)}>×</button>
            </div>
            <div className="v2-quantity-dialog-content">
              <table className="v2-quantity-table">
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
                          <div className="v2-product-info-text">
                            <div style={{color: '#333', fontSize: '14px', fontWeight: '500', marginBottom: '8px'}}>
                              {item.product_name} {item.product_name_sub}
                            </div>
                            <div style={{color: '#333', fontSize: '14px', marginBottom: '8px'}}>
                              {item.china_option1} {item.china_option2}
                            </div>
                            <div style={{lineHeight: '1.6'}}>
                              <span className="v2-info-tag order-number">
                                {item.order_number || ''}
                              </span>
                              <span className="v2-info-tag barcode">
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
                            className="v2-quantity-input"
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="v2-quantity-dialog-actions">
              {/* F열 혼용률 타입 선택 라디오 */}
              <div className="v2-label-formula-radio-group">
                <label className={`v2-label-formula-radio ${labelFormulaType === 'mixRate' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="labelFormulaType"
                    value="mixRate"
                    checked={labelFormulaType === 'mixRate'}
                    onChange={() => setLabelFormulaType('mixRate')}
                  />
                  {t('importProduct.dialog.mixRate')}
                </label>
                <label className={`v2-label-formula-radio ${labelFormulaType === 'backRef' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="labelFormulaType"
                    value="backRef"
                    checked={labelFormulaType === 'backRef'}
                    onChange={() => setLabelFormulaType('backRef')}
                  />
                  {t('importProduct.dialog.backRef')}
                </label>
              </div>
              <button
                className="v2-cancel-btn"
                onClick={handleSaveToPostgre}
                disabled={isSavingLabel}
              >
                {isSavingLabel ? '저장 중...' : 'LABEL postgre'}
              </button>
              <button
                className="v2-confirm-btn"
                onClick={handleQuantityConfirm}
                disabled={isSavingLabel}
              >
                {isSavingLabel ? t('importProduct.dialog.saving') : t('importProduct.dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 처리준비 모달 */}
      <ProcessReadyModal
        isOpen={isProcessReadyModalOpen}
        onClose={() => setIsProcessReadyModalOpen(false)}
        readyItems={readyItems}
        onBarcodeQtyChange={handleBarcodeQtyChange}
        onSave={handleReadySave}
        onSavePostgre={handleReadySavePostgre}
      />
    </div>
  );
};

export default ItemCheck;
