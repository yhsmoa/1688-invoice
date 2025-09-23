'use client';

import React, { useRef, useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import SearchForm from '../../component/SearchForm';
import './chinaorder-new.css';

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

interface ChinaOrderData {
  id: string;
  columnA?: string; // A열
  columnB?: string; // B열
  columnC?: string; // C열
  columnD?: string; // D열
  columnE?: string; // E열
  columnF?: string; // F열
  columnG?: string; // G열
  columnH?: string; // H열
  columnI?: string; // I열
  columnJ?: string; // J열
  img_url?: string; // K열 - 이미지 URL
  site_url?: string; // L열 - 사이트 링크 URL
  note?: string; // 메모
}

const ChinaOrderNew: React.FC = () => {
  const [orderData, setOrderData] = useState<ChinaOrderData[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ChinaOrderData | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<ChinaOrderData[]>([]);
  const [originalData, setOriginalData] = useState<ChinaOrderData[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>('전체');
  const [viewMode, setViewMode] = useState<string>('기본'); // '기본' 또는 '바코드 합치기'
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{[key: string]: string}>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [productQuantities, setProductQuantities] = useState<{ [key: string]: number }>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [showOrderCheckModal, setShowOrderCheckModal] = useState(false);
  const [orderCheckData, setOrderCheckData] = useState('');
  const [parsedOrderData, setParsedOrderData] = useState<any[]>([]);
  
  // 이미지 URL 프록시 처리
  const getProxyImageUrl = (url: string): string => {
    if (!url) return '';
    // 외부 CDN 이미지는 프록시를 통해 가져오기
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };
  
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [paginatedData, setPaginatedData] = useState<ChinaOrderData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  
  // 셀 편집 상태
  const [editingCell, setEditingCell] = useState<{id: string, field: string, subIndex?: number} | null>(null);
  const [cellValue, setCellValue] = useState<string>('');
  const [editingCellRef, setEditingCellRef] = useState<HTMLInputElement | null>(null);
  
  // 수정된 데이터 추적
  const [modifiedData, setModifiedData] = useState<{[key: string]: {[field: string]: number | null}}>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // 정렬 상태
  const [sortType, setSortType] = useState<string>('주문순서');

  // 정렬 함수
  const sortData = (data: ChinaOrderData[], sortType: string): ChinaOrderData[] => {
    const sortedData = [...data];
    
    if (sortType === '주문순서') {
      // ID 순으로 정렬
      return sortedData.sort((a, b) => {
        const aId = parseInt(a.id || '0');
        const bId = parseInt(b.id || '0');
        return aId - bId;
      });
    } else if (sortType === '품목별') {
      // 1. columnC 2. columnD 3. id 순서로 정렬
      return sortedData.sort((a, b) => {
        // 1차: columnC 비교
        const aColumnC = a.columnC || '';
        const bColumnC = b.columnC || '';
        const columnCCompare = aColumnC.localeCompare(bColumnC);
        
        if (columnCCompare !== 0) {
          return columnCCompare;
        }
        
        // 2차: columnD 비교
        const aColumnD = a.columnD || '';
        const bColumnD = b.columnD || '';
        const columnDCompare = aColumnD.localeCompare(bColumnD);
        
        if (columnDCompare !== 0) {
          return columnDCompare;
        }
        
        // 3차: id 비교
        const aId = parseInt(a.id || '0');
        const bId = parseInt(b.id || '0');
        return aId - bId;
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

  // 바코드 합치기 처리 함수
  const mergeDataByBarcode = (data: ChinaOrderData[]): ChinaOrderData[] => {
    const merged: { [key: string]: ChinaOrderData } = {};

    // L열(링크)로 먼저 정렬
    const sortedData = [...data].sort((a, b) => {
      const aLink = a.site_url || '';
      const bLink = b.site_url || '';
      return aLink.localeCompare(bLink);
    });

    sortedData.forEach(item => {
      const key = `${item.site_url || 'no-link'}_${item.columnF || 'no-barcode'}`; // L열(링크) + F열(바코드)를 기준으로 합치기
      
      if (merged[key]) {
        // L열과 F열이 모두 동일하면 개수(E열) 합치기
        const existingCount = parseInt(merged[key].columnE || '0');
        const newCount = parseInt(item.columnE || '0');
        merged[key].columnE = (existingCount + newCount).toString();
      } else {
        // 새로운 조합이면 그대로 추가
        merged[key] = { ...item };
      }
    });

    // L열(링크) 기준으로 다시 정렬하여 반환
    return Object.values(merged).sort((a, b) => {
      const aLink = a.site_url || '';
      const bLink = b.site_url || '';
      return aLink.localeCompare(bLink);
    });
  };

  // 뷰 모드 변경 핸들러
  const handleViewModeChange = (mode: string) => {
    setViewMode(mode);
    
    let dataToShow = orderData;
    if (mode === '바코드 합치기') {
      dataToShow = mergeDataByBarcode(orderData);
    }
    
    const sortedData = sortData(dataToShow, sortType);
    setFilteredData(sortedData);
    setCurrentPage(1);
  };

  // 페이지네이션 처리 함수
  const updatePaginatedData = (data: ChinaOrderData[]) => {
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
      let dataToShow = orderData;
      if (viewMode === '바코드 합치기') {
        dataToShow = mergeDataByBarcode(orderData);
      }
      const sortedData = sortData(dataToShow, sortType);
      setFilteredData(sortedData); // 검색어가 없으면 모든 데이터 표시 (정렬 적용)
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
      return;
    }

    // 기본적인 클라이언트 사이드 검색 구현
    let dataToSearch = orderData;
    if (viewMode === '바코드 합치기') {
      dataToSearch = mergeDataByBarcode(orderData);
    }

    const searchResults = dataToSearch.filter(item => 
      (item.columnA && item.columnA.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.columnB && item.columnB.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.columnC && item.columnC.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.columnD && item.columnD.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.columnF && item.columnF.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const sortedData = sortData(searchResults, sortType);
    setFilteredData(sortedData);
    setCurrentPage(1); // 검색 시 첫 페이지로 이동
  };

  // 검색어 변경 시 자동으로 필터링하지 않음 (메모리 효율성을 위해)
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // 검색 초기화 함수
  const resetSearch = () => {
    setSearchTerm(''); // 검색어 초기화
    let dataToShow = orderData;
    if (viewMode === '바코드 합치기') {
      dataToShow = mergeDataByBarcode(orderData);
    }
    const sortedData = sortData(dataToShow, sortType);
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

  const handleItemClick = (item: ChinaOrderData) => {
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

  // 모달 저장 함수
  const handleModalSave = () => {
    if (!pasteData.trim()) {
      alert('데이터를 입력해주세요.');
      return;
    }

    try {
      // TSV/CSV 데이터를 파싱
      const rows = pasteData.trim().split('\n');
      const newData: ChinaOrderData[] = [];

      rows.forEach((row, index) => {
        const columns = row.split('\t'); // 탭으로 분리 (구글 시트 복사 시 탭으로 분리됨)
        
        if (columns.length >= 10) { // 최소 K열까지 있어야 함
          newData.push({
            id: (index + 1).toString(),
            columnA: columns[0] || '',
            columnB: columns[1] || '',
            columnC: columns[2] || '',
            columnD: columns[3] || '',
            columnE: columns[4] || '',
            columnF: columns[5] || '',
            columnG: columns[6] || '',
            columnH: columns[7] || '',
            columnI: columns[8] || '',
            columnJ: columns[9] || '',
            img_url: columns[10] || '', // K열
            site_url: columns[11] || '', // L열
            note: ''
          });
        }
      });

      if (newData.length > 0) {
        let dataToShow = newData;
        if (viewMode === '바코드 합치기') {
          dataToShow = mergeDataByBarcode(newData);
        }
        const sortedData = sortData(dataToShow, sortType);
        setOrderData(newData);
        setFilteredData(sortedData);
        setCurrentPage(1);
        setShowUploadModal(false);
        setPasteData('');
      } else {
        alert('올바른 형식의 데이터가 없습니다.');
      }
    } catch (error) {
      console.error('데이터 파싱 오류:', error);
      alert('데이터 파싱 중 오류가 발생했습니다.');
    }
  };

  // 셀 편집 함수들
  const handleCellEdit = (id: string, field: string, subIndex?: number) => {
    const item = paginatedData.find(data => data.id === id);
    if (item) {
      let currentValue = '';
      switch (field) {
        case 'columnG':
          currentValue = item.columnG || '';
          break;
        case 'columnH':
          currentValue = item.columnH || '';
          break;
        case 'columnE':
          currentValue = item.columnE || '';
          break;
        case 'columnI':
          currentValue = item.columnI || '';
          break;
        case 'columnJ':
          currentValue = item.columnJ || '';
          break;
        case 'note':
          currentValue = item.note || '';
          break;
      }
      setCellValue(currentValue);
      setEditingCell({ id, field, subIndex });
    }
  };

  const handleCellSave = (id: string, field: string, subIndex?: number) => {
    // 데이터 업데이트
    const updatedOrderData = orderData.map(item => {
      if (item.id === id) {
        return { ...item, [field]: cellValue };
      }
      return item;
    });

    const updatedFilteredData = filteredData.map(item => {
      if (item.id === id) {
        return { ...item, [field]: cellValue };
      }
      return item;
    });

    setOrderData(updatedOrderData);
    setFilteredData(updatedFilteredData);
    setEditingCell(null);
    setCellValue('');
  };

  // URL에서 offerId 추출 함수
  const extractOfferId = (url: string): string => {
    if (!url) return '';
    const match = url.match(/\/offer\/(\d+)\.html/);
    return match ? match[1] : '';
  };

  // 주문 검수 모달 저장 함수
  const handleOrderCheckSave = () => {
    if (!orderCheckData.trim()) {
      alert('데이터를 입력해주세요.');
      return;
    }

    try {
      // 먼저 JSON 배열 형태로 파싱 시도
      const parsedData = JSON.parse(orderCheckData.trim());
      
      if (Array.isArray(parsedData)) {
        setParsedOrderData(parsedData);
        setShowOrderCheckModal(false);
        setOrderCheckData('');
        alert(`주문 검수 데이터 ${parsedData.length}개가 저장되었습니다.`);
      } else {
        alert('배열 형태의 JSON 데이터를 입력해주세요.');
      }
    } catch (error) {
      console.error('데이터 파싱 오류:', error);
      alert('올바른 JSON 배열 형식의 데이터를 입력해주세요.');
    }
  };

  // 선택된 아이템의 매칭되는 옵션 찾기
  const getMatchingOptions = (item: ChinaOrderData): any[] => {
    if (!item.site_url || parsedOrderData.length === 0) return [];
    
    const itemOfferId = extractOfferId(item.site_url);
    if (!itemOfferId) return [];
    
    const matchedOptions = parsedOrderData.filter(orderItem => orderItem.offerId === itemOfferId);
    // optionName 기준으로 정렬
    return matchedOptions.sort((a, b) => (a.optionName || '').localeCompare(b.optionName || ''));
  };

  // 주문 콘솔 코드 생성 함수
  const handleOrderConsole = () => {
    if (parsedOrderData.length === 0) {
      alert('먼저 주문 검수 데이터를 입력해주세요.');
      return;
    }

    // sellerName별로 데이터 그룹핑
    const groupedBySeller: {[key: string]: any[]} = {};
    
    parsedOrderData.forEach(order => {
      const seller = order.sellerName || '판매자 미지정';
      if (!groupedBySeller[seller]) {
        groupedBySeller[seller] = [];
      }
      groupedBySeller[seller].push(order);
    });

    // 콘솔 코드 생성
    let consoleCode = `// 1688 주문 메모 자동 입력 스크립트\n`;
    consoleCode += `(async function() {\n`;
    consoleCode += `  const orderData = {\n`;

    Object.keys(groupedBySeller).forEach(sellerName => {
      const sellerOrders = groupedBySeller[sellerName];
      
      // 바코드별로 수량 합치기 - 중복 바코드의 수량을 합산
      const barcodeMap: {[key: string]: {totalQuantity: number, option: string, date: string}} = {};
      
      // 이 seller의 모든 offerId 수집
      const sellerOfferIds = new Set(sellerOrders.map(order => order.offerId));
      
      // orderData에서 이 seller의 offerId와 매칭되는 모든 아이템을 한 번만 처리
      orderData.forEach(item => {
        const itemOfferId = extractOfferId(item.site_url || '');
        
        // 이 아이템이 현재 seller의 것인지 확인
        if (sellerOfferIds.has(itemOfferId)) {
          const barcode = item.columnF || '';
          const quantity = parseInt(item.columnE || '0');
          const option = `${item.columnG || ''} | ${item.columnH || ''}`.trim();
          const date = item.columnB || '';
          
          if (barcode && quantity > 0) {
            if (barcodeMap[barcode]) {
              // 동일한 바코드가 이미 있으면 수량을 합산
              barcodeMap[barcode].totalQuantity += quantity;
            } else {
              // 새로운 바코드 추가
              barcodeMap[barcode] = { 
                totalQuantity: quantity, 
                option, 
                date
              };
            }
          }
        }
      });

      // 주문 메모 생성 - 각 바코드별로 한 줄씩
      const memoLines: string[] = [];
      Object.keys(barcodeMap).forEach(barcode => {
        const data = barcodeMap[barcode];
        // 합산된 총 수량을 표시
        const line = `${data.date} // ${data.option} // ${barcode} // ${data.totalQuantity}ea`;
        memoLines.push(line);
      });

      // 여러 바코드가 있을 때는 줄바꿈으로 구분
      if (memoLines.length > 0) {
        consoleCode += `    "${sellerName}": \`${memoLines.join('\\n')}\`,\n`;
      }
    });

    consoleCode += `  };\n\n`;
    consoleCode += `  // 메모란 입력 시작\n`;
    consoleCode += `  console.log('🔄 메모란 입력 중...');\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 모든 order-group-container 찾기\n`;
    consoleCode += `  const orderGroups = document.querySelectorAll('.order-group-container');\n`;
    consoleCode += `  let successCount = 0;\n`;
    consoleCode += `  let failCount = 0;\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 비동기 처리를 위한 함수\n`;
    consoleCode += `  async function processTextarea(container, shopName, orderText) {\n`;
    consoleCode += `    return new Promise((resolve) => {\n`;
    consoleCode += `      const qTextarea = container.querySelector('q-textarea');\n`;
    consoleCode += `      \n`;
    consoleCode += `      if (!qTextarea) {\n`;
    consoleCode += `        console.log(\`❌ \${shopName}: q-textarea 컴포넌트를 찾을 수 없습니다.\`);\n`;
    consoleCode += `        failCount++;\n`;
    consoleCode += `        resolve(false);\n`;
    consoleCode += `        return;\n`;
    consoleCode += `      }\n`;
    consoleCode += `      \n`;
    consoleCode += `      // 먼저 q-textarea를 클릭하여 활성화\n`;
    consoleCode += `      qTextarea.click();\n`;
    consoleCode += `      qTextarea.focus();\n`;
    consoleCode += `      \n`;
    consoleCode += `      // 약간의 대기 시간 후 textarea 찾기\n`;
    consoleCode += `      setTimeout(() => {\n`;
    consoleCode += `        // 여러 방법으로 textarea 찾기\n`;
    consoleCode += `        let textarea = qTextarea.querySelector('textarea');\n`;
    consoleCode += `        \n`;
    consoleCode += `        // Shadow DOM 체크\n`;
    consoleCode += `        if (!textarea && qTextarea.shadowRoot) {\n`;
    consoleCode += `          textarea = qTextarea.shadowRoot.querySelector('textarea');\n`;
    consoleCode += `        }\n`;
    consoleCode += `        \n`;
    consoleCode += `        // q-textarea 컴포넌트 자체가 input을 받을 수 있는 경우\n`;
    consoleCode += `        if (!textarea && qTextarea.tagName === 'Q-TEXTAREA') {\n`;
    consoleCode += `          // Web Component의 속성이나 메서드 직접 접근 시도\n`;
    consoleCode += `          if (typeof qTextarea.setValue === 'function') {\n`;
    consoleCode += `            qTextarea.setValue(orderText);\n`;
    consoleCode += `            console.log(\`✅ \${shopName}: 메모 입력 완료 (setValue 메서드)\`);\n`;
    consoleCode += `            successCount++;\n`;
    consoleCode += `            resolve(true);\n`;
    consoleCode += `            return;\n`;
    consoleCode += `          } else if (qTextarea.value !== undefined) {\n`;
    consoleCode += `            qTextarea.value = orderText;\n`;
    consoleCode += `            // 컴포넌트에 이벤트 발생\n`;
    consoleCode += `            qTextarea.dispatchEvent(new Event('input', { bubbles: true }));\n`;
    consoleCode += `            qTextarea.dispatchEvent(new Event('change', { bubbles: true }));\n`;
    consoleCode += `            console.log(\`✅ \${shopName}: 메모 입력 완료 (value 속성)\`);\n`;
    consoleCode += `            successCount++;\n`;
    consoleCode += `            resolve(true);\n`;
    consoleCode += `            return;\n`;
    consoleCode += `          }\n`;
    consoleCode += `        }\n`;
    consoleCode += `        \n`;
    consoleCode += `        if (textarea) {\n`;
    consoleCode += `          // textarea 포커스\n`;
    consoleCode += `          textarea.focus();\n`;
    consoleCode += `          \n`;
    consoleCode += `          // 값 설정 - 여러 방법 시도\n`;
    consoleCode += `          textarea.value = orderText;\n`;
    consoleCode += `          textarea.setAttribute('value', orderText);\n`;
    consoleCode += `          textarea.textContent = orderText;\n`;
    consoleCode += `          \n`;
    consoleCode += `          // 다양한 이벤트 발생 (React/Vue 컴포넌트 호환)\n`;
    consoleCode += `          const inputEvent = new Event('input', { bubbles: true, cancelable: true });\n`;
    consoleCode += `          const changeEvent = new Event('change', { bubbles: true, cancelable: true });\n`;
    consoleCode += `          const keyupEvent = new KeyboardEvent('keyup', { bubbles: true, cancelable: true });\n`;
    consoleCode += `          \n`;
    consoleCode += `          textarea.dispatchEvent(inputEvent);\n`;
    consoleCode += `          textarea.dispatchEvent(changeEvent);\n`;
    consoleCode += `          textarea.dispatchEvent(keyupEvent);\n`;
    consoleCode += `          \n`;
    consoleCode += `          // React의 경우를 위한 추가 처리\n`;
    consoleCode += `          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;\n`;
    consoleCode += `          nativeInputValueSetter.call(textarea, orderText);\n`;
    consoleCode += `          const evt = new Event('input', { bubbles: true });\n`;
    consoleCode += `          textarea.dispatchEvent(evt);\n`;
    consoleCode += `          \n`;
    consoleCode += `          console.log(\`✅ \${shopName}: 메모 입력 완료\`);\n`;
    consoleCode += `          successCount++;\n`;
    consoleCode += `          resolve(true);\n`;
    consoleCode += `        } else {\n`;
    consoleCode += `          console.log(\`❌ \${shopName}: textarea를 찾을 수 없습니다.\`);\n`;
    consoleCode += `          failCount++;\n`;
    consoleCode += `          resolve(false);\n`;
    consoleCode += `        }\n`;
    consoleCode += `      }, 200); // 컴포넌트 렌더링 대기\n`;
    consoleCode += `    });\n`;
    consoleCode += `  }\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 모든 컨테이너 처리\n`;
    consoleCode += `  const promises = [];\n`;
    consoleCode += `  orderGroups.forEach((container) => {\n`;
    consoleCode += `    const shopLink = container.querySelector('.shop-link');\n`;
    consoleCode += `    if (!shopLink) return;\n`;
    consoleCode += `    \n`;
    consoleCode += `    const shopName = shopLink.textContent.trim();\n`;
    consoleCode += `    \n`;
    consoleCode += `    if (orderData[shopName]) {\n`;
    consoleCode += `      promises.push(processTextarea(container, shopName, orderData[shopName]));\n`;
    consoleCode += `    }\n`;
    consoleCode += `  });\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 모든 처리 완료 대기\n`;
    consoleCode += `  await Promise.all(promises);\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 결과 요약\n`;
    consoleCode += `  console.log('\\n📊 === 실행 결과 ===');\n`;
    consoleCode += `  console.log(\`✅ 성공: \${successCount}개\`);\n`;
    consoleCode += `  console.log(\`❌ 실패: \${failCount}개\`);\n`;
    consoleCode += `  console.log(\`📋 전체 판매자: \${shopTitles.length}개\`);\n`;
    consoleCode += `  console.log(\`📝 입력 데이터: \${Object.keys(orderData).length}개\`);\n`;
    consoleCode += `  \n`;
    consoleCode += `  if (failCount > 0) {\n`;
    consoleCode += `    console.log('\\n💡 실패한 경우 해결 방법:');\n`;
    consoleCode += `    console.log('1. 각 판매자의 메모란을 한 번 클릭하여 활성화');\n`;
    consoleCode += `    console.log('2. 페이지를 새로고침 후 다시 시도');\n`;
    consoleCode += `    console.log('3. 장바구니 페이지가 완전히 로드된 후 실행');\n`;
    consoleCode += `  }\n`;
    consoleCode += `})();\n`;

    // 클립보드에 복사 (fallback 방법 포함)
    const copyToClipboard = async (text: string) => {
      try {
        // 먼저 navigator.clipboard API 시도
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          alert('콘솔 코드가 클립보드에 복사되었습니다!\n1688 장바구니 페이지에서 F12를 눌러 콘솔을 열고 붙여넣기 후 실행하세요.');
        } else {
          // fallback: textarea를 생성하여 복사
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          try {
            document.execCommand('copy');
            alert('콘솔 코드가 클립보드에 복사되었습니다!\n1688 장바구니 페이지에서 F12를 눌러 콘솔을 열고 붙여넣기 후 실행하세요.');
          } catch (err) {
            console.error('클립보드 복사 실패:', err);
            // 복사 실패 시 콘솔에 코드 출력
            console.log('=== 아래 코드를 복사하여 사용하세요 ===');
            console.log(text);
            alert('클립보드 복사에 실패했습니다. 콘솔(F12)에서 코드를 확인하세요.');
          } finally {
            document.body.removeChild(textArea);
          }
        }
      } catch (err) {
        console.error('클립보드 복사 실패:', err);
        // 복사 실패 시 콘솔에 코드 출력
        console.log('=== 아래 코드를 복사하여 사용하세요 ===');
        console.log(text);
        alert('클립보드 복사에 실패했습니다. 콘솔(F12)에서 코드를 확인하세요.');
      }
    };
    
    copyToClipboard(consoleCode);
  };

  // 엑셀 다운로드 함수
  const handleExcelDownload = () => {
    try {
      // 바코드별 비고 매핑 생성
      const barcodeNoteMap: {[key: string]: string} = {};
      orderData.forEach(item => {
        if (item.note && item.note.trim() && item.columnF) {
          barcodeNoteMap[item.columnF] = item.note;
        }
      });

      // 원본 데이터(orderData)를 기준으로 엑셀 다운로드
      const excelData = orderData.map(item => {
        // 동일한 바코드에 비고가 있으면 적용
        let noteToUse = item.note || '';
        if (item.columnF && barcodeNoteMap[item.columnF]) {
          noteToUse = barcodeNoteMap[item.columnF];
        }

        // J열 계산: I열(단가) * E열(개수)
        const quantity = parseFloat(item.columnE || '0');
        const unitPrice = parseFloat(item.columnI || '0');
        const totalPrice = (quantity * unitPrice).toFixed(2);

        return [
          `="${item.columnA || ''}"`, // A열 (텍스트 타입으로 저장)
          item.columnB || '', // B열
          item.columnC || '', // C열
          item.columnD || '', // D열
          item.columnE || '', // E열
          item.columnF || '', // F열
          item.columnG || '', // G열
          item.columnH || '', // H열
          item.columnI || '', // I열
          totalPrice, // J열 (I열 * E열 계산값)
          item.img_url || '', // K열
          item.site_url || '', // L열
          '', // M열 (빈 열)
          '', // N열 (빈 열)
          '', // O열 (빈 열)
          '', // P열 (빈 열)
          noteToUse, // Q열 (비고 - 동일 바코드 공유)
        ];
      });

      // CSV 형식으로 변환
      const csvContent = excelData.map(row => 
        row.map(cell => {
          // 쉼표나 따옴표가 포함된 경우 처리
          const cellStr = String(cell);
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return '"' + cellStr.replace(/"/g, '""') + '"';
          }
          return cellStr;
        }).join(',')
      ).join('\n');

      // BOM 추가하여 한글 깨짐 방지
      const BOM = '\uFEFF';
      const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
      
      // 파일 다운로드
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `주문데이터_${new Date().toISOString().slice(0, 10)}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };


  return (
    <div className="china-order-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="china-order-main-content">
        <LeftsideMenu />
        <main className="china-order-content">
          <div className="china-order-container">
            <h1 className="china-order-title">신규 주문</h1>

            {/* 컨트롤 섹션 (정렬 옵션과 저장 버튼) */}
            <div className="china-order-control-section">
              <div className="china-order-left-controls">
                <select 
                  className="china-order-sort-dropdown"
                  value={sortType}
                  onChange={handleSortTypeChange}
                >
                  <option value="주문순서">주문순서</option>
                  <option value="품목별">품목별</option>
                </select>
              </div>
              <div className="china-order-right-controls">
                <button className="china-order-modal-upload-btn" onClick={() => setShowUploadModal(true)}>주문 시트</button>
                <button 
                  className={`china-order-excel-download-btn active`}
                  disabled={isSaving}
                  onClick={() => setShowOrderCheckModal(true)}
                >
                  {isSaving ? '생성 중...' : '주문 검수'}
                </button>
                <button className="china-order-excel-download-btn active" onClick={handleOrderConsole}>주문 콘솔</button>
                <button className="china-order-excel-download-btn active" onClick={handleExcelDownload}>엑셀 다운</button>
              </div>
            </div>

            {/* 검색 영역 */}
            <div className="china-order-search-section">
              <div className="china-order-search-board">
                <div className="china-order-view-mode-container">
                  <div className="china-order-radio-group">
                    <label className="china-order-radio-label">
                      <input
                        type="radio"
                        name="viewMode"
                        value="기본"
                        checked={viewMode === '기본'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="china-order-radio-input"
                      />
                      기본
                    </label>
                    <label className="china-order-radio-label">
                      <input
                        type="radio"
                        name="viewMode"
                        value="바코드 합치기"
                        checked={viewMode === '바코드 합치기'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="china-order-radio-input"
                      />
                      바코드 합치기
                    </label>
                  </div>
                </div>
                <div className="china-order-search-form-container">
                  <input 
                    type="text" 
                    placeholder="상품명, 글번호 등을 입력하세요" 
                    className="china-order-search-input"
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="china-order-search-button" onClick={handleSearchClick}>검색</button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div className="china-order-table-board">
              <table className="china-order-table">
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
                        className="china-order-table-checkbox"
                      />
                    </th>
                    <th>업체명</th>
                    <th>이미지</th>
                    <th>글번호</th>
                    <th>상품명</th>
                    <th>주문옵션</th>
                    <th>개수</th>
                    <th>위안</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="china-order-empty-data">로딩 중...</td>
                    </tr>
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="china-order-empty-data">주문 데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    paginatedData.map((item, index) => {
                      // 바코드 합치기 모드에서 아래 링크가 현재와 동일한지 확인
                      const removeBottomBorder = viewMode === '바코드 합치기' && 
                        index < paginatedData.length - 1 && 
                        paginatedData[index + 1].site_url === item.site_url;
                      
                      return (
                        <tr key={item.id} className={removeBottomBorder ? 'china-order-remove-bottom-border' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRows.has(item.id)}
                              onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                              className="china-order-table-checkbox"
                            />
                          </td>
                        <td>
                          기타
                        </td>
                        <td>
                          {item.img_url ? (
                            <div className="china-order-image-preview-container">
                              <img 
                                src={getProxyImageUrl(item.img_url || '')} 
                                alt="상품 이미지" 
                                className="china-order-product-thumbnail"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = '/placeholder.svg';
                                }}
                              />
                              <div 
                                className="china-order-image-preview"
                                style={{
                                  top: `${mousePosition.y - 150}px`,
                                  left: `${mousePosition.x + 30}px`
                                }}
                              >
                                <img 
                                  src={getProxyImageUrl(item.img_url || '')} 
                                  alt="상품 이미지 미리보기" 
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="china-order-no-image">이미지 없음</div>
                          )}
                        </td>
                        <td>
                          <span 
                            className="china-order-order-number-text"
                            onClick={() => handleItemClick(item)}
                          >
                            {item.columnA || ''}<br />
                            {item.columnB || ''}
                          </span>
                        </td>
                        <td>
                          <div className="china-order-product-name">
                            {item.site_url ? (
                              <a 
                                href={item.site_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="china-order-clickable-product-link"
                              >
                                {item.columnC || ''}<br />
                                {item.columnD || ''}<br />
                                {item.columnF || ''}
                              </a>
                            ) : (
                              <>
                                {item.columnC || ''}<br />
                                {item.columnD || ''}<br />
                                {item.columnF || ''}
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="china-order-china-options">
                            <div 
                              onClick={() => handleCellEdit(item.id, 'columnG', 0)}
                              style={{cursor: 'pointer', minHeight: '20px', borderBottom: '1px solid #eee', marginBottom: '2px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'columnG' && editingCell?.subIndex === 0 ? (
                                <input 
                                  type="text" 
                                  value={cellValue} 
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'columnG', 0)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'columnG', 0)}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent'}}
                                />
                              ) : (
                                item.columnG || ''
                              )}
                            </div>
                            <div 
                              onClick={() => handleCellEdit(item.id, 'columnH', 1)}
                              style={{cursor: 'pointer', minHeight: '20px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'columnH' && editingCell?.subIndex === 1 ? (
                                <input 
                                  type="text" 
                                  value={cellValue} 
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'columnH', 1)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'columnH', 1)}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent'}}
                                />
                              ) : (
                                item.columnH || ''
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div 
                            onClick={() => handleCellEdit(item.id, 'columnE')}
                            style={{cursor: 'pointer', minHeight: '20px'}}
                          >
                            {editingCell?.id === item.id && editingCell?.field === 'columnE' ? (
                              <input 
                                type="text" 
                                value={cellValue} 
                                onChange={(e) => setCellValue(e.target.value)}
                                onBlur={() => handleCellSave(item.id, 'columnE')}
                                onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'columnE')}
                                autoFocus
                                style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'center'}}
                              />
                            ) : (
                              item.columnE || ''
                            )}
                          </div>
                        </td>
                        <td>
                          <div>
                            <div 
                              onClick={() => handleCellEdit(item.id, 'columnI', 0)}
                              style={{cursor: 'pointer', minHeight: '20px', borderBottom: '1px solid #eee', marginBottom: '2px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'columnI' && editingCell?.subIndex === 0 ? (
                                <input 
                                  type="text" 
                                  value={cellValue} 
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'columnI', 0)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'columnI', 0)}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'center'}}
                                />
                              ) : (
                                item.columnI || ''
                              )}
                            </div>
                            <div 
                              onClick={() => handleCellEdit(item.id, 'columnJ', 1)}
                              style={{cursor: 'pointer', minHeight: '20px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'columnJ' && editingCell?.subIndex === 1 ? (
                                <input 
                                  type="text" 
                                  value={cellValue} 
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'columnJ', 1)}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'columnJ', 1)}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'center'}}
                                />
                              ) : (
                                item.columnJ || ''
                              )}
                            </div>
                          </div>
                        </td>
                          <td style={{ textAlign: 'center' }}>
                            <div 
                              onClick={() => handleCellEdit(item.id, 'note')}
                              style={{cursor: 'pointer', minHeight: '20px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'note' ? (
                                <input 
                                  type="text" 
                                  value={cellValue} 
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'note')}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'note')}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'center'}}
                                />
                              ) : (
                                item.note || ''
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            {/* 페이지네이션 */}
            {!loading && filteredData.length > 0 && (
              <div className="china-order-pagination">
                <button 
                  onClick={goToPrevPage} 
                  disabled={currentPage === 1}
                  className="china-order-pagination-button"
                >
                  이전
                </button>
                
                <div className="china-order-page-numbers">
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
                        className={`china-order-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button 
                  onClick={goToNextPage} 
                  disabled={currentPage === totalPages}
                  className="china-order-pagination-button"
                >
                  다음
                </button>
                
                <span className="china-order-page-info">
                  {currentPage} / {totalPages} 페이지 (총 {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="china-order-drawer-container">
          <div className="china-order-drawer">
            <div className="china-order-drawer-header">
              <h2>주문 상세 정보</h2>
              <button className="china-order-close-btn" onClick={closeDrawer}>×</button>
            </div>
            <div className="china-order-drawer-content">
              {selectedItem && (
                <div>
                  {/* 매칭되는 옵션 리스트 */}
                  {(() => {
                    const matchingOptions = getMatchingOptions(selectedItem);
                    return matchingOptions.length > 0 && (
                      <div style={{ marginTop: '20px' }}>
                        <h4>검수 데이터 매칭 옵션</h4>
                        <div style={{ padding: '10px' }}>
                          {matchingOptions.map((option, index) => (
                            <div key={index} style={{ 
                              padding: '12px 0', 
                              borderBottom: index < matchingOptions.length - 1 ? '1px solid #eee' : 'none',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '12px'
                            }}>
                              {/* 이미지 */}
                              <div style={{ flexShrink: 0 }}>
                                {option.imageUrl ? (
                                  <img 
                                    src={getProxyImageUrl(option.imageUrl || '')} 
                                    alt="상품 이미지" 
                                    style={{
                                      width: '60px', 
                                      height: '60px', 
                                      objectFit: 'cover',
                                      border: '1px solid #ddd',
                                      borderRadius: '4px'
                                    }}
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                                    }}
                                  />
                                ) : (
                                  <div style={{
                                    width: '60px', 
                                    height: '60px', 
                                    backgroundColor: '#f5f5f5',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    color: '#999'
                                  }}>
                                    이미지없음
                                  </div>
                                )}
                              </div>
                              
                              {/* 옵션 정보 */}
                              <div style={{ flex: 1, fontSize: '14px', lineHeight: '1.4' }}>
                                <div style={{ 
                                  fontWeight: '500', 
                                  marginBottom: '4px',
                                  color: option.orderStatus === false ? 'red' : 'inherit'
                                }}>
                                  {option.optionName || '옵션 정보 없음'}
                                  {option.orderStatus !== undefined && (
                                    <span style={{ marginLeft: '8px' }}>
                                      {option.orderStatus === true ? '✅' : '❌'}
                                    </span>
                                  )}
                                </div>
                                <div style={{ color: '#666' }}>
                                  개수: {option.quantity || '0'}
                                </div>
                                <div style={{ color: '#666' }}>
                                  단가: {(() => {
                                    const quantity = parseFloat(option.quantity || '0');
                                    const subtotal = parseFloat(option.subtotal || '0');
                                    if (quantity > 0) {
                                      return (subtotal / quantity).toFixed(2);
                                    }
                                    return '0.00';
                                  })()}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()} 
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 주문 검수 모달 */}
      {showOrderCheckModal && (
        <div className="china-order-upload-modal-overlay" onClick={() => setShowOrderCheckModal(false)}>
          <div className="china-order-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="china-order-upload-modal-header">
              <div className="china-order-upload-modal-buttons">
                <button className="china-order-modal-cancel-btn" onClick={() => setShowOrderCheckModal(false)}>
                  취소
                </button>
                <button className="china-order-modal-save-btn" onClick={handleOrderCheckSave}>
                  검수
                </button>
              </div>
            </div>
            <div className="china-order-upload-modal-content">
              <textarea
                className="china-order-paste-area"
                placeholder="주문 검수 데이터를 JSON 형식으로 입력하세요..."
                value={orderCheckData}
                onChange={(e) => setOrderCheckData(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* 모달 업로드 창 */}
      {showUploadModal && (
        <div className="china-order-upload-modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="china-order-upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="china-order-upload-modal-header">
              <div className="china-order-upload-modal-buttons">
                <button className="china-order-modal-cancel-btn" onClick={() => setShowUploadModal(false)}>
                  취소
                </button>
                <button className="china-order-modal-save-btn" onClick={handleModalSave}>
                  저장
                </button>
              </div>
            </div>
            <div className="china-order-upload-modal-content">
              <textarea
                className="china-order-paste-area"
                placeholder="구글 시트 데이터를 여기에 붙여넣기 하세요..."
                value={pasteData}
                onChange={(e) => setPasteData(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChinaOrderNew;