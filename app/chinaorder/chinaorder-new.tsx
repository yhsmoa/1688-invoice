'use client';

import React, { useRef, useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import SearchForm from '../../component/SearchForm';
import './chinaorder-new.css';
import * as XLSX from 'xlsx';

// 클립보드 복사 유틸리티 함수 (HTTP/HTTPS 모두 지원)
const copyToClipboard = (text: string): Promise<void> => {
  // Try modern clipboard API first (HTTPS)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback to execCommand for HTTP
  return new Promise<void>((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        resolve();
      } else {
        reject(new Error('execCommand failed'));
      }
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
};

// 클립보드 복사 성공 토스트 표시
const showCopyToast = () => {
  const existingToast = document.querySelector('.copy-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'copy-toast';
  toast.textContent = 'Copy!';
  toast.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    z-index: 10000;
    animation: fadeInOut 1.5s ease-in-out;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 1500);
};

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
  note?: string; // 비고
  cancelStatus?: string; // 취소 상태 (취소-사유)
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
  const [viewMode, setViewMode] = useState<string>('기본'); // '기본' 또는 '사이트 합치기'
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<{[key: string]: string}>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [showQuantityDialog, setShowQuantityDialog] = useState(false);
  const [copyButtonStates, setCopyButtonStates] = useState<{[key: string]: boolean}>({});
  const [productQuantities, setProductQuantities] = useState<{ [key: string]: number }>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [showOrderCheckModal, setShowOrderCheckModal] = useState(false);
  const [orderCheckData, setOrderCheckData] = useState('');
  const [parsedOrderData, setParsedOrderData] = useState<any[]>([]);
  const [cancelReasons, setCancelReasons] = useState<{[key: string]: string}>({});
  const [canceledItems, setCanceledItems] = useState<{[key: string]: boolean}>({});
  
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

  // 이미지 교체 상태 (사이트별로 토글)
  const [imageReplaced, setImageReplaced] = useState<{[siteUrl: string]: boolean}>({});

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

  // 사이트 합치기 처리 함수 - offerId별로 그룹화
  const groupBySite = (data: ChinaOrderData[]): { [siteUrl: string]: ChinaOrderData[] } => {
    const groups: { [siteUrl: string]: ChinaOrderData[] } = {};

    // offerId로 정렬
    const sortedData = [...data].sort((a, b) => {
      const aOfferId = extractOfferId(a.site_url || '');
      const bOfferId = extractOfferId(b.site_url || '');
      return aOfferId.localeCompare(bOfferId);
    });

    sortedData.forEach(item => {
      const offerId = extractOfferId(item.site_url || '');

      // offerId가 있으면 offerId로 그룹화, 없으면 'no-link'로 그룹화
      const key = offerId || 'no-link';

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    return groups;
  };

  // 뷰 모드 변경 핸들러
  const handleViewModeChange = (mode: string) => {
    setViewMode(mode);
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
    if (viewMode === '사이트 합치기') {
      // 사이트 합치기 모드: 그룹 수 기준으로 페이지 계산
      const grouped = groupBySite(filteredData);
      const groupCount = Object.keys(grouped).length;
      setTotalPages(Math.ceil(groupCount / itemsPerPage));
    } else {
      // 기본 모드: 일반 페이지네이션
      updatePaginatedData(filteredData);
    }
  }, [filteredData, currentPage, viewMode]);

  // 검색 함수
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      const sortedData = sortData(orderData, sortType);
      setFilteredData(sortedData); // 검색어가 없으면 모든 데이터 표시 (정렬 적용)
      setCurrentPage(1); // 검색 시 첫 페이지로 이동
      return;
    }

    // 기본적인 클라이언트 사이드 검색 구현
    const searchResults = orderData.filter(item => {
      // 기본 검색 (상품명 등)
      const basicSearch =
        (item.columnA && item.columnA.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.columnB && item.columnB.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.columnC && item.columnC.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.columnD && item.columnD.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.columnF && item.columnF.toLowerCase().includes(searchTerm.toLowerCase()));

      // sellerName 및 offerId 검색
      const offerId = extractOfferId(item.site_url || '');
      const matchedOrder = parsedOrderData.find(order => order.offerId === offerId);
      const sellerSearch = matchedOrder?.sellerName?.toLowerCase().includes(searchTerm.toLowerCase());
      const offerIdSearch = offerId.toLowerCase().includes(searchTerm.toLowerCase());

      return basicSearch || sellerSearch || offerIdSearch;
    });

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
    const sortedData = sortData(orderData, sortType);
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
            note: columns[16] || '' // Q열 - 비고
          });
        }
      });

      if (newData.length > 0) {
        const sortedData = sortData(newData, sortType);
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
    // 사이트 합치기 모드에서는 filteredData에서, 기본 모드에서는 paginatedData에서 찾기
    const item = (viewMode === '사이트 합치기' ? filteredData : paginatedData).find(data => data.id === id);
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
        case 'cancelStatus':
          currentValue = item.cancelStatus || '';
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

  // URL 정리 함수 (쿼리 파라미터 제거)
  const cleanUrl = (url: string): string => {
    if (!url) return '';
    // URL에서 쿼리 파라미터 제거
    const urlWithoutQuery = url.split('?')[0];
    return urlWithoutQuery;
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
        // optionName에서 ";已选定制服务" 제거
        const cleanedData = parsedData.map((item: any) => {
          if (item.optionName && typeof item.optionName === 'string') {
            return {
              ...item,
              optionName: item.optionName.replace(/;已选定制服务/g, '').trim()
            };
          }
          return item;
        });

        setParsedOrderData(cleanedData);

        // 가격 자동 업데이트 (4단계 매칭 로직 적용)
        const findMatchedVerification = (itemOfferId: string, itemOptionName: string) => {
          const normalizedItemOption = normalizeOptionName(itemOptionName);

          // 1차: 정확한 매칭
          let matched = cleanedData.find((orderItem: any) => {
            const verificationOfferId = orderItem.offerId || '';
            const verificationOptionName = orderItem.optionName || '';
            const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
            return verificationOfferId === itemOfferId && normalizedVerificationOption === normalizedItemOption;
          });

          // 2차: 순서 바꿔서 매칭
          if (!matched) {
            const reversedItemOption = reverseOptionOrder(normalizedItemOption);
            matched = cleanedData.find((orderItem: any) => {
              const verificationOfferId = orderItem.offerId || '';
              const verificationOptionName = orderItem.optionName || '';
              const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
              return verificationOfferId === itemOfferId && normalizedVerificationOption === reversedItemOption;
            });
          }

          // 3차: cm, 码 제거하고 매칭
          if (!matched) {
            const itemOptionForMatching = normalizeForMatching(normalizedItemOption);
            matched = cleanedData.find((orderItem: any) => {
              const verificationOfferId = orderItem.offerId || '';
              const verificationOptionName = orderItem.optionName || '';
              const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
              const verificationOptionForMatching = normalizeForMatching(normalizedVerificationOption);
              return verificationOfferId === itemOfferId && verificationOptionForMatching === itemOptionForMatching;
            });
          }

          // 4차: 순서 바꾸고 + cm, 码 제거하고 매칭
          if (!matched) {
            const reversedItemOption = reverseOptionOrder(normalizedItemOption);
            const itemOptionForMatching = normalizeForMatching(reversedItemOption);
            matched = cleanedData.find((orderItem: any) => {
              const verificationOfferId = orderItem.offerId || '';
              const verificationOptionName = orderItem.optionName || '';
              const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
              const verificationOptionForMatching = normalizeForMatching(normalizedVerificationOption);
              return verificationOfferId === itemOfferId && verificationOptionForMatching === itemOptionForMatching;
            });
          }

          return matched;
        };

        const updatedOrderData = orderData.map(item => {
          const itemOfferId = extractOfferId(item.site_url || '');
          const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
          const normalizedItemOption = normalizeOptionName(itemOptionName);

          if (!itemOfferId || !normalizedItemOption || normalizedItemOption === ';') return item;

          const matchedVerification = findMatchedVerification(itemOfferId, itemOptionName);

          if (matchedVerification) {
            let updates: any = {};

            // 가격이 일치하지 않으면 업데이트
            if (matchedVerification.price) {
              const verificationPrice = String(matchedVerification.price);
              if (item.columnI !== verificationPrice) {
                updates.columnI = verificationPrice;
              }
            }

            // 이미지가 없는 경우 매칭된 이미지로 교체
            if (!item.img_url && matchedVerification.imageUrl) {
              updates.img_url = matchedVerification.imageUrl;
            }

            if (Object.keys(updates).length > 0) {
              return { ...item, ...updates };
            }
          }

          return item;
        });

        const updatedFilteredData = filteredData.map(item => {
          const itemOfferId = extractOfferId(item.site_url || '');
          const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
          const normalizedItemOption = normalizeOptionName(itemOptionName);

          if (!itemOfferId || !normalizedItemOption || normalizedItemOption === ';') return item;

          const matchedVerification = findMatchedVerification(itemOfferId, itemOptionName);

          if (matchedVerification) {
            let updates: any = {};

            // 가격이 일치하지 않으면 업데이트
            if (matchedVerification.price) {
              const verificationPrice = String(matchedVerification.price);
              if (item.columnI !== verificationPrice) {
                updates.columnI = verificationPrice;
              }
            }

            // 이미지가 없는 경우 매칭된 이미지로 교체
            if (!item.img_url && matchedVerification.imageUrl) {
              updates.img_url = matchedVerification.imageUrl;
            }

            if (Object.keys(updates).length > 0) {
              return { ...item, ...updates };
            }
          }

          return item;
        });

        setOrderData(updatedOrderData);
        setFilteredData(updatedFilteredData);
        setShowOrderCheckModal(false);
        setOrderCheckData('');
        alert(`주문 검수 데이터 ${cleanedData.length}개가 저장되었습니다.`);
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

  // offerId로 sellerName 가져오기
  const getSellerNameByOfferId = (offerId: string): string => {
    if (!offerId || parsedOrderData.length === 0) return '';

    const matchedItem = parsedOrderData.find(orderItem => orderItem.offerId === offerId);
    return matchedItem?.sellerName || '';
  };

  // 해당 사이트의 옵션 불일치 여부 확인
  const hasUnmatchedOptionsInSite = (siteUrl: string, groupedData: ChinaOrderData[]): boolean => {
    return groupedData.some(item => {
      const status = getVerificationStatus(item);
      return status === 'offerId-only';
    });
  };

  // 해당 사이트의 개수 불일치 상태 확인
  const getQuantityIssuesInSite = (siteUrl: string, groupedData: ChinaOrderData[]): { hasInsufficient: boolean; hasExcess: boolean } => {
    let hasInsufficient = false;
    let hasExcess = false;

    groupedData.forEach(item => {
      const qtyStatus = getQuantityStatus(item);
      if (qtyStatus === 'insufficient') hasInsufficient = true;
      if (qtyStatus === 'excess') hasExcess = true;
    });

    return { hasInsufficient, hasExcess };
  };

  // D열에 '+' 포함 여부 확인 (SET 상품)
  const isSetProduct = (item: ChinaOrderData): boolean => {
    return (item.columnD || '').includes('+');
  };

  // 옵션명 정규화 (FREE와 均码를 동일하게 처리)
  const normalizeOptionName = (optionName: string): string => {
    if (!optionName) return '';

    let normalized = optionName;

    // 1. 괄호나 브래킷으로 둘러싸인 내용 제거 (예: "均码【85-120斤】" -> "均码", "2XL (125-135斤)" -> "2XL")
    normalized = normalized.replace(/[【\[（\(].+?[】\]）\)]/g, '').trim();

    // 2. FREE를 均码로 통일
    normalized = normalized.replace(/FREE/g, '均码');

    // 3. 2XL, 3XL, 4XL <-> XXL, XXXL, XXXXL 상호 변환
    // 먼저 숫자형태를 X반복형태로 변환 (2XL -> XXL)
    normalized = normalized.replace(/\b(\d+)XL\b/gi, (match, num) => {
      return 'X'.repeat(parseInt(num)) + 'L';
    });

    return normalized;
  };

  // 옵션 매칭을 위한 정규화 함수 (cm, 码 제거 + 부분 일치를 위한 괄호/브래킷 내용 제거)
  const normalizeForMatching = (optionName: string): string => {
    if (!optionName) return '';

    let normalized = optionName;

    // cm, 码로 끝나는 경우 제거
    normalized = normalized.replace(/cm$/i, '').replace(/码$/, '').trim();

    // 괄호나 브래킷으로 둘러싸인 내용 제거 (예: "2XL【125-135斤】" -> "2XL", "2XL (125-135斤)" -> "2XL")
    normalized = normalized.replace(/[【\[（\(].+?[】\]）\)]/g, '').trim();

    return normalized;
  };

  // 옵션 순서를 바꾼 버전 생성 (예: "130cm; 粉色" -> "粉色; 130cm")
  const reverseOptionOrder = (optionName: string): string => {
    if (!optionName) return '';
    const parts = optionName.split(/[;；]/).map(p => p.trim()).filter(p => p);
    if (parts.length === 2) {
      return `${parts[1]}; ${parts[0]}`;
    }
    return optionName;
  };

  // 해당 아이템의 검수 데이터에서 price 가져오기
  const getPriceFromVerification = (item: ChinaOrderData): string => {
    if (!item.site_url || parsedOrderData.length === 0) return '';

    const itemOfferId = extractOfferId(item.site_url);
    const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
    const normalizedItemOption = normalizeOptionName(itemOptionName);

    if (!itemOfferId || !normalizedItemOption || normalizedItemOption === ';') return '';

    // 1차: 정확한 매칭
    let matchedItem = parsedOrderData.find(orderItem => {
      const verificationOfferId = orderItem.offerId || '';
      const verificationOptionName = orderItem.optionName || '';
      const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
      return verificationOfferId === itemOfferId && normalizedVerificationOption === normalizedItemOption;
    });

    // 2차: 순서 바꿔서 매칭 (예: "130cm; 粉色" <-> "粉色; 130cm")
    if (!matchedItem) {
      const reversedItemOption = reverseOptionOrder(normalizedItemOption);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        return verificationOfferId === itemOfferId && normalizedVerificationOption === reversedItemOption;
      });
    }

    // 3차: cm, 码 제거하고 매칭
    if (!matchedItem) {
      const itemOptionForMatching = normalizeForMatching(normalizedItemOption);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationOptionForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === itemOfferId && verificationOptionForMatching === itemOptionForMatching;
      });
    }

    // 4차: 순서 바꾸고 + cm, 码 제거하고 매칭
    if (!matchedItem) {
      const reversedItemOption = reverseOptionOrder(normalizedItemOption);
      const itemOptionForMatching = normalizeForMatching(reversedItemOption);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationOptionForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === itemOfferId && verificationOptionForMatching === itemOptionForMatching;
      });
    }

    return matchedItem?.price || '';
  };

  // 동일한 offerId와 optionName을 가진 항목들의 총 개수 계산
  const getTotalQuantityForOption = (offerId: string, optionName: string): number => {
    const normalizedOptionName = normalizeOptionName(optionName);
    return orderData
      .filter(item => {
        const itemOfferId = extractOfferId(item.site_url || '');
        const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
        const normalizedItemOption = normalizeOptionName(itemOptionName);
        return itemOfferId === offerId && normalizedItemOption === normalizedOptionName;
      })
      .reduce((sum, item) => sum + (parseInt(item.columnE || '0') || 0), 0);
  };

  // 검수 데이터에서 개수 가져오기
  const getVerificationQuantity = (offerId: string, optionName: string): number => {
    const normalizedOptionName = normalizeOptionName(optionName);

    // 1차: 정확한 매칭
    let matchedItem = parsedOrderData.find(orderItem => {
      const verificationOfferId = orderItem.offerId || '';
      const verificationOptionName = orderItem.optionName || '';
      const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
      return verificationOfferId === offerId && normalizedVerificationOption === normalizedOptionName;
    });

    // 2차: 순서 바꿔서 매칭
    if (!matchedItem) {
      const reversedOption = reverseOptionOrder(normalizedOptionName);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        return verificationOfferId === offerId && normalizedVerificationOption === reversedOption;
      });
    }

    // 3차: cm, 码 제거하고 매칭
    if (!matchedItem) {
      const optionForMatching = normalizeForMatching(normalizedOptionName);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === offerId && verificationForMatching === optionForMatching;
      });
    }

    // 4차: 순서 바꾸고 + cm, 码 제거하고 매칭
    if (!matchedItem) {
      const reversedOption = reverseOptionOrder(normalizedOptionName);
      const optionForMatching = normalizeForMatching(reversedOption);
      matchedItem = parsedOrderData.find(orderItem => {
        const verificationOfferId = orderItem.offerId || '';
        const verificationOptionName = orderItem.optionName || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === offerId && verificationForMatching === optionForMatching;
      });
    }

    return matchedItem ? (parseInt(matchedItem.quantity || '0') || 0) : 0;
  };

  // 개수 불일치 상태 확인: 'matched' | 'insufficient' | 'excess' | 'not-verified'
  const getQuantityStatus = (item: ChinaOrderData): 'matched' | 'insufficient' | 'excess' | 'not-verified' => {
    if (parsedOrderData.length === 0) return 'not-verified';

    const itemOfferId = extractOfferId(item.site_url || '');
    const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
    const normalizedItemOption = normalizeOptionName(itemOptionName);

    if (!itemOfferId || !normalizedItemOption || normalizedItemOption === ';') return 'not-verified';

    // 검수 데이터에 해당 옵션이 있는지 확인 (정규화된 옵션명으로 비교)
    const verificationQty = getVerificationQuantity(itemOfferId, normalizedItemOption);
    if (verificationQty === 0) return 'not-verified';

    // 동일한 offerId와 optionName의 총 개수 계산 (정규화된 옵션명으로 비교)
    const totalQty = getTotalQuantityForOption(itemOfferId, normalizedItemOption);

    if (totalQty === verificationQty) return 'matched';
    if (totalQty < verificationQty) return 'excess'; // 검수개수 > 테이블개수 = 초과
    return 'insufficient'; // 검수개수 < 테이블개수 = 부족
  };

  // 검수 상태 확인 함수: 'matched' | 'offerId-only' | 'not-matched'
  const getVerificationStatus = (item: ChinaOrderData): 'matched' | 'offerId-only' | 'not-matched' => {
    if (parsedOrderData.length === 0) return 'not-matched';

    // 현재 아이템의 optionName 생성 (G & "; " & H)
    const itemOptionName = `${item.columnG || ''}; ${item.columnH || ''}`.trim();
    if (!itemOptionName || itemOptionName === ';') return 'not-matched';

    // 현재 아이템의 offerId 추출
    const itemOfferId = extractOfferId(item.site_url || '');
    if (!itemOfferId) return 'not-matched';

    // 동일한 offerId를 가진 검수 데이터가 있는지 확인
    const hasMatchingOfferId = parsedOrderData.some(orderItem => {
      const verificationOfferId = orderItem.offerId || '';
      return verificationOfferId === itemOfferId;
    });

    if (!hasMatchingOfferId) return 'not-matched';

    // 옵션명 정규화 (FREE = 均码)
    const normalizedItemOption = normalizeOptionName(itemOptionName);

    // 4단계 매칭 로직으로 검수 데이터 확인
    // 1차: 정확한 매칭
    let hasMatchingOption = parsedOrderData.some(orderItem => {
      const verificationOptionName = orderItem.optionName || '';
      const verificationOfferId = orderItem.offerId || '';
      const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
      return verificationOfferId === itemOfferId && normalizedVerificationOption === normalizedItemOption;
    });

    // 2차: 순서 바꿔서 매칭
    if (!hasMatchingOption) {
      const reversedItemOption = reverseOptionOrder(normalizedItemOption);
      hasMatchingOption = parsedOrderData.some(orderItem => {
        const verificationOptionName = orderItem.optionName || '';
        const verificationOfferId = orderItem.offerId || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        return verificationOfferId === itemOfferId && normalizedVerificationOption === reversedItemOption;
      });
    }

    // 3차: cm, 码 제거하고 매칭
    if (!hasMatchingOption) {
      const itemOptionForMatching = normalizeForMatching(normalizedItemOption);
      hasMatchingOption = parsedOrderData.some(orderItem => {
        const verificationOptionName = orderItem.optionName || '';
        const verificationOfferId = orderItem.offerId || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === itemOfferId && verificationForMatching === itemOptionForMatching;
      });
    }

    // 4차: 순서 바꾸고 + cm, 码 제거하고 매칭
    if (!hasMatchingOption) {
      const reversedItemOption = reverseOptionOrder(normalizedItemOption);
      const itemOptionForMatching = normalizeForMatching(reversedItemOption);
      hasMatchingOption = parsedOrderData.some(orderItem => {
        const verificationOptionName = orderItem.optionName || '';
        const verificationOfferId = orderItem.offerId || '';
        const normalizedVerificationOption = normalizeOptionName(verificationOptionName);
        const verificationForMatching = normalizeForMatching(normalizedVerificationOption);
        return verificationOfferId === itemOfferId && verificationForMatching === itemOptionForMatching;
      });
    }

    return hasMatchingOption ? 'matched' : 'offerId-only';
  };

  // 기존 함수 유지 (하위 호환성)
  const isMatchedWithVerification = (item: ChinaOrderData): boolean => {
    return getVerificationStatus(item) === 'matched';
  };

  // 보드별 전체 체크박스 선택/해제
  const handleBoardSelectAll = (siteUrl: string, items: ChinaOrderData[], checked: boolean) => {
    const newSelected = new Set(selectedRows);

    if (checked) {
      // 모두 선택
      items.forEach(item => {
        newSelected.add(item.id);
      });
    } else {
      // 모두 해제
      items.forEach(item => {
        newSelected.delete(item.id);
      });
    }

    setSelectedRows(newSelected);
  };

  // 취소 버튼 클릭 처리
  const handleCancelSelected = (siteUrl: string) => {
    const selectedReason = cancelReasons[siteUrl] || '';
    const newCanceledItems = { ...canceledItems };
    const newOrderData = [...orderData];
    const newFilteredData = [...filteredData];

    // 체크박스가 하나도 선택되지 않은 경우, 해당 보드의 모든 데이터를 대상으로 처리
    const grouped = groupBySite(filteredData);
    const siteData = grouped[siteUrl] || [];

    const targetRows = selectedRows.size > 0
      ? Array.from(selectedRows)
      : siteData.map(item => item.id);

    // 선택된 행들(또는 보드의 모든 행들)에 대해 처리
    targetRows.forEach(rowId => {
      const item = orderData.find(d => d.id === rowId);
      if (!item) return;

      // 해당 item의 offerId와 동일한지 확인
      const itemOfferId = extractOfferId(item.site_url || '');
      const siteOfferId = siteUrl === 'no-link' ? '' : siteUrl; // siteUrl은 이미 offerId

      if (itemOfferId === siteOfferId) {
        // 취소 토글 처리 (이미 취소되어 있으면 취소 해제)
        if (newCanceledItems[rowId]) {
          delete newCanceledItems[rowId];

          // 취소 해제 시 취소 상태 제거
          const orderIndex = newOrderData.findIndex(d => d.id === rowId);
          const filteredIndex = newFilteredData.findIndex(d => d.id === rowId);

          if (orderIndex !== -1) {
            newOrderData[orderIndex] = { ...newOrderData[orderIndex], cancelStatus: '' };
          }
          if (filteredIndex !== -1) {
            newFilteredData[filteredIndex] = { ...newFilteredData[filteredIndex], cancelStatus: '' };
          }
        } else {
          // 입력 처리
          if (selectedReason && selectedReason !== '선택' && selectedReason !== '--------------------------') {
            const orderIndex = newOrderData.findIndex(d => d.id === rowId);
            const filteredIndex = newFilteredData.findIndex(d => d.id === rowId);

            if (orderIndex !== -1) {
              newOrderData[orderIndex] = { ...newOrderData[orderIndex], cancelStatus: selectedReason };
            }
            if (filteredIndex !== -1) {
              newFilteredData[filteredIndex] = { ...newFilteredData[filteredIndex], cancelStatus: selectedReason };
            }

            // [취소]가 포함된 경우에만 canceledItems에 추가
            if (selectedReason.includes('[취소]')) {
              newCanceledItems[rowId] = true;
            }
          }
        }
      }
    });

    setCanceledItems(newCanceledItems);
    setOrderData(newOrderData);
    setFilteredData(newFilteredData);
  };

  // 이미지 교체 토글 함수
  const handleImageReplace = (siteUrl: string) => {
    // 해당 보드의 데이터 가져오기
    const siteData = groupBySite(filteredData)[siteUrl] || [];

    // 체크된 항목이 있는지 확인
    const checkedItems = siteData.filter((item: ChinaOrderData) => selectedRows.has(item.id));

    if (checkedItems.length > 0) {
      // 체크된 항목만 이미지 교체
      setOrderData(prevData => prevData.map(item => {
        if (checkedItems.some((checkedItem: ChinaOrderData) => checkedItem.id === item.id)) {
          const itemOfferId = extractOfferId(item.site_url || '');
          const itemOption = `${item.columnG || ''}|${item.columnH || ''}`.trim();

          const matchedOrder = parsedOrderData.find(order => {
            if (order.offerId !== itemOfferId) return false;
            const orderOption = normalizeOptionName((order.optionName || '').replace(/\s+/g, '').replace(/[;；]/g, '|'));
            const itemOptionNormalized = normalizeOptionName(itemOption.replace(/\s+/g, '').replace(/[;；]/g, '|'));
            return orderOption === itemOptionNormalized;
          });

          if (matchedOrder?.imageUrl) {
            return { ...item, img_url: matchedOrder.imageUrl };
          }
        }
        return item;
      }));
    } else {
      // 체크된 항목이 없으면 전체 보드 이미지 교체
      setImageReplaced(prev => ({
        ...prev,
        [siteUrl]: !prev[siteUrl]
      }));
    }
  };

  // 이미지 URL 가져오기 함수 (교체 상태에 따라)
  const getImageUrl = (item: ChinaOrderData, siteUrl: string): string => {
    if (imageReplaced[siteUrl]) {
      // 교체 상태: parsedOrderData에서 매칭되는 imageUrl 찾기
      const itemOfferId = extractOfferId(item.site_url || '');
      const itemOption = `${item.columnG || ''}|${item.columnH || ''}`.trim();
      const normalizedItemOption = normalizeOptionName(itemOption.replace(/\s+/g, '').replace(/[;；]/g, '|'));

      // 1차: 정확한 매칭
      let matchedOrder = parsedOrderData.find(order => {
        if (order.offerId !== itemOfferId) return false;
        const orderOption = normalizeOptionName((order.optionName || '').replace(/\s+/g, '').replace(/[;；]/g, '|'));
        return orderOption === normalizedItemOption;
      });

      // 2차: 순서 바꿔서 매칭
      if (!matchedOrder) {
        const reversedItemOption = reverseOptionOrder(normalizedItemOption);
        matchedOrder = parsedOrderData.find(order => {
          if (order.offerId !== itemOfferId) return false;
          const orderOption = normalizeOptionName((order.optionName || '').replace(/\s+/g, '').replace(/[;；]/g, '|'));
          return orderOption === reversedItemOption;
        });
      }

      // 3차: cm, 码 제거하고 매칭
      if (!matchedOrder) {
        const itemOptionForMatching = normalizeForMatching(normalizedItemOption);
        matchedOrder = parsedOrderData.find(order => {
          if (order.offerId !== itemOfferId) return false;
          const orderOption = normalizeOptionName((order.optionName || '').replace(/\s+/g, '').replace(/[;；]/g, '|'));
          const orderOptionForMatching = normalizeForMatching(orderOption);
          return orderOptionForMatching === itemOptionForMatching;
        });
      }

      // 4차: 순서 바꾸고 + cm, 码 제거하고 매칭
      if (!matchedOrder) {
        const reversedItemOption = reverseOptionOrder(normalizedItemOption);
        const itemOptionForMatching = normalizeForMatching(reversedItemOption);
        matchedOrder = parsedOrderData.find(order => {
          if (order.offerId !== itemOfferId) return false;
          const orderOption = normalizeOptionName((order.optionName || '').replace(/\s+/g, '').replace(/[;；]/g, '|'));
          const orderOptionForMatching = normalizeForMatching(orderOption);
          return orderOptionForMatching === itemOptionForMatching;
        });
      }

      return matchedOrder?.imageUrl || item.img_url || '';
    }
    // 원본 상태
    return item.img_url || '';
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
    consoleCode += `  // 실패한 항목 수집\n`;
    consoleCode += `  const failedItems = [];\n`;
    consoleCode += `  orderGroups.forEach((container) => {\n`;
    consoleCode += `    const shopLink = container.querySelector('.shop-link');\n`;
    consoleCode += `    if (!shopLink) return;\n`;
    consoleCode += `    const shopName = shopLink.textContent.trim();\n`;
    consoleCode += `    if (orderData[shopName]) {\n`;
    consoleCode += `      const qTextarea = container.querySelector('q-textarea');\n`;
    consoleCode += `      if (!qTextarea) {\n`;
    consoleCode += `        failedItems.push(shopName);\n`;
    consoleCode += `      }\n`;
    consoleCode += `    }\n`;
    consoleCode += `  });\n`;
    consoleCode += `  \n`;
    consoleCode += `  const totalCount = successCount + failCount;\n`;
    consoleCode += `  const allSuccess = failCount === 0 && successCount > 0;\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 결과 출력\n`;
    consoleCode += `  if (allSuccess) {\n`;
    consoleCode += `    console.log('%c🛒 ' + successCount + ' / ' + totalCount + ' 건 성공', 'background: #4CAF50; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');\n`;
    consoleCode += `  } else if (failCount > 0) {\n`;
    consoleCode += `    console.log('%c🛒 ' + successCount + ' / ' + totalCount + ' 건 성공', 'background: #FF9800; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');\n`;
    consoleCode += `    console.log('%c❌ 실패건', 'background: #F44336; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');\n`;
    consoleCode += `    failedItems.forEach(item => {\n`;
    consoleCode += `      console.log('  - ' + item);\n`;
    consoleCode += `    });\n`;
    consoleCode += `  }\n`;
    consoleCode += `  \n`;
    consoleCode += `  // 모두 성공 시 주소 변경 버튼 클릭\n`;
    consoleCode += `  if (allSuccess) {\n`;
    consoleCode += `    console.log('%c💯 Perfect', 'background: #4CAF50; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');\n`;
    consoleCode += `    \n`;
    consoleCode += `    // 주소 변경 버튼 클릭\n`;
    consoleCode += `    setTimeout(() => {\n`;
    consoleCode += `      document.querySelector('.address-action:nth-child(1)').click();\n`;
    consoleCode += `      console.log('%c📍 주소 변경 버튼 클릭 완료', 'background: #2196F3; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');\n`;
    consoleCode += `    }, 1000);\n`;
    consoleCode += `  }\n`;
    consoleCode += `})();\n`;

    // 클립보드에 복사
    copyToClipboard(consoleCode).then(() => {
      alert('✅ [주문번호 입력 콘솔] 코드가 클립보드에 복사되었습니다!\n\n📌 1688 장바구니 페이지에서:\n1. F12를 눌러 개발자 콘솔 열기\n2. 붙여넣기 (Ctrl+V) 후 Enter\n3. 자동으로 주문번호 입력 + 주소변경 완료');
    }).catch((err) => {
      console.error('클립보드 복사 실패:', err);
      console.log('=== 아래 [주문번호 입력 콘솔] 코드를 복사하여 사용하세요 ===');
      console.log(consoleCode);
      alert('클립보드 복사에 실패했습니다. 콘솔(F12)에서 코드를 확인하세요.');
    });
  };

  // 엑셀 다운로드 함수 (1개 파일, 2개 시트: 성공, 취소)
  const handleExcelDownload = () => {
    try {
      // 바코드별 비고 매핑 생성
      const barcodeNoteMap: {[key: string]: string} = {};
      orderData.forEach(item => {
        if (item.note && item.note.trim() && item.columnF) {
          barcodeNoteMap[item.columnF] = item.note;
        }
      });

      // 성공 데이터와 취소 데이터 분리
      const successData: any[][] = [];
      const canceledData: any[][] = [];

      orderData.forEach(item => {
        // 동일한 바코드에 비고가 있으면 적용
        let noteToUse = item.note || '';
        if (item.columnF && barcodeNoteMap[item.columnF]) {
          noteToUse = barcodeNoteMap[item.columnF];
        }

        // J열 계산: I열(단가) * E열(개수)
        const quantity = parseFloat(item.columnE || '0');
        const unitPrice = parseFloat(item.columnI || '0');
        const totalPrice = (quantity * unitPrice).toFixed(2);

        // 이미지 URL: 교체된 이미지가 있으면 사용, 없으면 원본 사용
        const itemOfferId = extractOfferId(item.site_url || '');
        const imageUrlToUse = getImageUrl(item, itemOfferId);

        const rowData = [
          item.columnA || '', // A열
          item.columnB || '', // B열
          item.columnC || '', // C열
          item.columnD || '', // D열
          item.columnE || '', // E열
          item.columnF || '', // F열
          item.columnG || '', // G열
          item.columnH || '', // H열
          item.columnI || '', // I열
          totalPrice, // J열 (I열 * E열 계산값)
          imageUrlToUse, // K열 (교체된 이미지 또는 원본)
          item.site_url || '', // L열
          '', // M열 (빈 열)
          '', // N열 (빈 열)
          '', // O열 (빈 열)
          '', // P열 (빈 열)
          noteToUse, // Q열 (비고 - 동일 바코드 공유)
          item.cancelStatus || '', // R열 (취소 상태)
        ];

        // 취소 여부에 따라 분리
        if (canceledItems[item.id]) {
          canceledData.push(rowData);
        } else {
          successData.push(rowData);
        }
      });

      // 워크북 생성
      const wb = XLSX.utils.book_new();

      // 성공 시트 생성 및 추가
      if (successData.length > 0) {
        const successWS = XLSX.utils.aoa_to_sheet(successData);
        XLSX.utils.book_append_sheet(wb, successWS, '성공');
      }

      // 취소 시트 생성 및 추가
      if (canceledData.length > 0) {
        const cancelWS = XLSX.utils.aoa_to_sheet(canceledData);
        XLSX.utils.book_append_sheet(wb, cancelWS, '취소');
      }

      // 엑셀 파일 다운로드
      XLSX.writeFile(wb, `주문데이터_${new Date().toISOString().slice(0, 10)}.xlsx`);

      alert(`엑셀 다운로드 완료!\n성공: ${successData.length}개\n취소: ${canceledData.length}개`);

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
                <button className="china-order-excel-download-btn active" onClick={handleOrderConsole}>주문번호 입력 콘솔</button>
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
                        value="사이트 합치기"
                        checked={viewMode === '사이트 합치기'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="china-order-radio-input"
                      />
                      사이트 합치기
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
            {viewMode === '사이트 합치기' ? (
              // 사이트별로 분리된 보드 표시
              (() => {
                // 전체 데이터를 offerId로 그룹화
                const grouped = groupBySite(filteredData);
                const siteUrls = Object.keys(grouped);

                // 페이지네이션 적용 (그룹 단위로)
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const paginatedSiteUrls = siteUrls.slice(startIndex, endIndex);

                return (
                  <div>
                    {loading ? (
                      <div className="china-order-table-board">
                        <div className="china-order-empty-data">로딩 중...</div>
                      </div>
                    ) : filteredData.length === 0 ? (
                      <div className="china-order-table-board">
                        <div className="china-order-empty-data">주문 데이터가 없습니다.</div>
                      </div>
                    ) : (
                      <>
                      {paginatedSiteUrls.map((siteUrl, boardIndex) => {
                        const offerId = siteUrl === 'no-link' ? '' : siteUrl; // siteUrl은 이제 offerId
                        const sellerName = getSellerNameByOfferId(offerId);
                        const hasUnmatchedOptions = hasUnmatchedOptionsInSite(siteUrl, grouped[siteUrl]);
                        const quantityIssues = getQuantityIssuesInSite(siteUrl, grouped[siteUrl]);

                        // 그룹의 첫 번째 아이템에서 실제 URL 가져오기
                        const displayUrl = grouped[siteUrl][0]?.site_url ? cleanUrl(grouped[siteUrl][0].site_url) : '';

                        return (
                        <div key={boardIndex} style={{ marginBottom: '30px' }}>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: '#f5f5f5',
                            padding: '10px 15px',
                            marginBottom: '10px',
                            borderRadius: '4px',
                            fontWeight: 'bold'
                          }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <button
                              onClick={() => {
                                const siteData = grouped[siteUrl];
                                const ordersArray = siteData.map(item => {
                                  const options = [];
                                  if (item.columnG) options.push(item.columnG);
                                  if (item.columnH) options.push(item.columnH);

                                  const color = options[0] || '';
                                  const size = options[1] || '';
                                  const quantity = parseInt(item.columnE || '1') || 1;

                                  // "+" 포함 여부와 관계없이 일단 전체를 하나의 주문으로 생성
                                  return {
                                    color: color,
                                    size: size,
                                    quantity: quantity,
                                    hasPlus: color.includes('+'),
                                    splitColors: color.includes('+') ? color.split('+').map(c => c.trim()) : null
                                  };
                                }).filter(order => order.color || order.size);

                                const consoleCode = `const orders = ${JSON.stringify(ordersArray, null, 4)};

const results = {
    failed: [],
    success: []
};

function clickPlusButton(plusButton, times) {
    return new Promise((resolve) => {
        let clickCount = 0;

        function clickNext() {
            if (clickCount < times) {
                plusButton.click();
                clickCount++;
                setTimeout(clickNext, 150);
            } else {
                resolve();
            }
        }

        clickNext();
    });
}

function inputQuantitiesForColor(color, sizeQuantities, hasPlus, splitColors) {
    return new Promise((resolve) => {
        const colorButtons = document.querySelectorAll('.sku-filter-button');
        let targetColorButton = null;

        // 1차: 전체 색상으로 검색 (예: "白色长袖+雪纺裙摆")
        colorButtons.forEach(button => {
            const labelName = button.querySelector('.label-name');
            if (labelName && labelName.textContent.trim() === color) {
                targetColorButton = button;
            }
        });

        // 2차: "+" 포함된 경우 전체로 못 찾았으면 분리된 색상들로 재시도
        if (!targetColorButton && hasPlus && splitColors) {
            console.log(\`"\${color}" 전체로 찾을 수 없음. 분리된 색상으로 재시도...\`);
            // 분리된 각 색상에 대해 개별 주문 처리
            Promise.all(splitColors.map(splitColor =>
                inputQuantitiesForColor(splitColor, [{ size: sizeQuantities[0].size, quantity: 1 }], false, null)
            )).then(() => resolve(true));
            return;
        }

        if (!targetColorButton) {
            sizeQuantities.forEach(({ size, quantity }) => {
                results.failed.push(\`\${color} - 사이즈 \${size} - \${quantity}개 (색상 버튼을 찾을 수 없음)\`);
            });
            resolve(false);
            return;
        }

        targetColorButton.click();

        setTimeout(async () => {
            const expandItems = document.querySelectorAll('.expand-view-item');

            // 사이즈 DIV가 없는 경우 (색상만 존재) - 색상 버튼의 plus 버튼으로 바로 수량 입력
            if (expandItems.length === 0) {
                const colorPlusButton = targetColorButton.querySelector('.anticon-plus.enable');
                if (colorPlusButton) {
                    const totalQuantity = sizeQuantities.reduce((sum, item) => sum + item.quantity, 0);
                    await clickPlusButton(colorPlusButton, totalQuantity);
                    results.success.push(\`\${color} - \${totalQuantity}개 (사이즈 없음)\`);
                    resolve(true);
                    return;
                } else {
                    sizeQuantities.forEach(({ size, quantity }) => {
                        results.failed.push(\`\${color} - 사이즈 \${size} - \${quantity}개 (색상 버튼 비활성화)\`);
                    });
                    resolve(false);
                    return;
                }
            }

            for (const { size, quantity } of sizeQuantities) {
                let found = false;
                let replacementNote = '';

                // 사이즈 변환 함수
                function getSizeVariants(size) {
                    const variants = [size]; // 원본 사이즈

                    // FREE 예외 처리
                    if (size === 'FREE') {
                        variants.push('均码');
                    }
                    if (size === '均码') {
                        variants.push('FREE');
                    }

                    // 2XL, 3XL, 4XL -> XXL, XXXL, XXXXL
                    if (/^\\d+XL$/i.test(size)) {
                        const num = parseInt(size);
                        variants.push('X'.repeat(num) + 'L');
                    }

                    // XXL, XXXL, XXXXL -> 2XL, 3XL, 4XL
                    if (/^X{2,}L$/i.test(size)) {
                        const xCount = size.match(/X/gi).length;
                        variants.push(xCount + 'XL');
                    }

                    return variants;
                }

                const sizeVariants = getSizeVariants(size);
                let searchSize = size;

                // 1차: 정확히 일치하는 사이즈 찾기
                for (const variant of sizeVariants) {
                    for (const item of expandItems) {
                        const label = item.querySelector('.item-label');
                        const sizeTitle = label ? label.getAttribute('title') : null;

                        if (sizeTitle === variant) {
                            const plusButton = item.querySelector('.anticon-plus.enable');
                            if (plusButton) {
                                await clickPlusButton(plusButton, quantity);
                                replacementNote = variant !== size ? \` (\${variant}로 대체)\` : '';
                                results.success.push(\`\${color} - 사이즈 \${size} - \${quantity}개\${replacementNote}\`);
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) break;
                }

                // 1.5차: FREE/均码의 경우 부분 일치 검색 (정확 일치 실패 시)
                if (!found && (size === 'FREE' || size === '均码')) {
                    const matchedItems = [];
                    for (const variant of sizeVariants) {
                        for (const item of expandItems) {
                            const label = item.querySelector('.item-label');
                            const sizeTitle = label ? label.getAttribute('title') : null;

                            if (sizeTitle && sizeTitle.includes(variant)) {
                                if (!matchedItems.find(m => m.sizeTitle === sizeTitle)) {
                                    matchedItems.push({ item, sizeTitle });
                                }
                            }
                        }
                    }

                    if (matchedItems.length === 1) {
                        const plusButton = matchedItems[0].item.querySelector('.anticon-plus.enable');
                        if (plusButton) {
                            await clickPlusButton(plusButton, quantity);
                            results.success.push(\`\${color} - 사이즈 \${size} - \${quantity}개 (부분일치: \${matchedItems[0].sizeTitle})\`);
                            found = true;
                        }
                    }
                }

                // 2차: S,M,L,XL,2XL,3XL,4XL 등의 경우 부분 일치 검색 (단, 유일해야 함)
                if (!found && /^(S|M|L|XL|\\d+XL)$/i.test(size)) {
                    // 원본 사이즈와 변환된 사이즈 모두로 부분 일치 검색
                    const sizesToSearch = [size];

                    // 2XL -> XXL, XXL -> 2XL 변환도 추가
                    if (/^\\d+XL$/i.test(size)) {
                        const num = parseInt(size);
                        sizesToSearch.push('X'.repeat(num) + 'L');
                    }
                    if (/^X{2,}L$/i.test(size)) {
                        const xCount = size.match(/X/gi).length;
                        sizesToSearch.push(xCount + 'XL');
                    }

                    const matchedItems = [];
                    for (const searchSize of sizesToSearch) {
                        for (const item of expandItems) {
                            const label = item.querySelector('.item-label');
                            const sizeTitle = label ? label.getAttribute('title') : null;

                            // 사이즈가 포함되어 있는지 확인 (예: "2XL【125-135斤】", "XXL (125-135斤)")
                            if (sizeTitle && sizeTitle.includes(searchSize)) {
                                // 중복 방지
                                if (!matchedItems.find(m => m.sizeTitle === sizeTitle)) {
                                    matchedItems.push({ item, sizeTitle });
                                }
                            }
                        }
                    }

                    // 정확히 1개만 매칭된 경우에만 허용
                    if (matchedItems.length === 1) {
                        const plusButton = matchedItems[0].item.querySelector('.anticon-plus.enable');
                        if (plusButton) {
                            await clickPlusButton(plusButton, quantity);
                            results.success.push(\`\${color} - 사이즈 \${size} - \${quantity}개 (부분일치: \${matchedItems[0].sizeTitle})\`);
                            found = true;
                        }
                    }
                }

                if (!found) {
                    results.failed.push(\`\${color} - 사이즈 \${size} - \${quantity}개\`);
                }
            }

            resolve(true);
        }, 400);
    });
}

async function processAllOrders() {
    const ordersByColor = {};
    const orderMetadata = {};

    orders.forEach(order => {
        if (!ordersByColor[order.color]) {
            ordersByColor[order.color] = [];
            orderMetadata[order.color] = {
                hasPlus: order.hasPlus,
                splitColors: order.splitColors
            };
        }
        ordersByColor[order.color].push({ size: order.size, quantity: order.quantity });
    });

    for (const color in ordersByColor) {
        const { hasPlus, splitColors } = orderMetadata[color];
        await inputQuantitiesForColor(color, ordersByColor[color], hasPlus, splitColors);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalCount = orders.length;
    const successCount = results.success.length;
    const failCount = results.failed.length;
    const allSuccess = failCount === 0 && successCount > 0;

    // 결과 출력
    if (allSuccess) {
        console.log('%c🛒 ' + successCount + ' / ' + totalCount + ' 건 성공', 'background: #4CAF50; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');
    } else if (failCount > 0) {
        console.log('%c🛒 ' + successCount + ' / ' + totalCount + ' 건 성공', 'background: #FF9800; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');
        console.log('%c❌ 실패건', 'background: #F44336; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');
        results.failed.forEach(item => {
            console.log('  - ' + item);
        });
    }

    // 모두 성공 시 자동 주문
    if (allSuccess) {
        console.log('%c💯 Perfect', 'background: #4CAF50; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');

        // 여러 셀렉터로 장바구니 추가 버튼 찾기
        let addCartButton = document.querySelector('button.v-button[data-click="ADD_CART"]');
        if (!addCartButton) {
            addCartButton = document.querySelector('button[data-click="ADD_CART"]');
        }
        if (!addCartButton) {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(btn => {
                if (btn.textContent && (btn.textContent.includes('加入进货单') || btn.textContent.includes('ADD_CART'))) {
                    addCartButton = btn;
                }
            });
        }

        if (addCartButton) {
            addCartButton.click();
            console.log('%c✅ 장바구니 추가 완료', 'background: #4CAF50; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');
        } else {
            console.log('%c❌ 주문 버튼을 찾을 수 없습니다', 'background: #F44336; color: white; padding: 8px 16px; font-weight: bold; font-size: 32px; border-radius: 8px; text-align: center; display: block; width: 100%;');
        }
    }
}

processAllOrders();`;

                                copyToClipboard(consoleCode).then(() => {
                                  showCopyToast();
                                }).catch((err) => {
                                  console.error('클립보드 복사 실패:', err);
                                  alert('✅ [개별 주문 자동입력 콘솔] 코드가 클립보드에 복사되었습니다!\n\n📌 이 상품 페이지에서:\n1. F12를 눌러 개발자 콘솔 열기\n2. 붙여넣기 (Ctrl+V) 후 Enter\n3. 자동으로 색상/사이즈/수량 입력 완료\n\n⚠️ 주의: 한 상품만 입력됩니다');
                                  console.log('=== 아래 [개별 주문 자동입력] 코드를 복사하여 사용하세요 ===');
                                  console.log(consoleCode);
                                });
                              }}
                              style={{
                                padding: '6px 12px',
                                marginRight: '10px',
                                background: 'white',
                                color: '#333',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px'
                              }}
                              title="개별 주문 자동입력 콘솔 (이 상품만 입력)"
                            >
                              📄 주문복사
                            </button>
                            사이트: {siteUrl === 'no-link' ? '링크 없음' : (
                              <>
                                <a
                                  href={displayUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: '#000',
                                    textDecoration: 'none'
                                  }}
                                >
                                  {displayUrl}
                                </a>
                                {sellerName && (
                                  <>
                                    <span style={{ marginLeft: '10px', color: '#000' }}>|</span>
                                    <span
                                      onClick={() => {
                                        copyToClipboard(sellerName).then(() => {
                                          showCopyToast();
                                        }).catch((err) => {
                                          console.error('복사 실패:', err);
                                        });
                                      }}
                                      style={{
                                        marginLeft: '5px',
                                        color: '#000',
                                        cursor: 'pointer',
                                        textDecoration: 'none'
                                      }}
                                    >
                                      {sellerName}
                                    </span>
                                  </>
                                )}
                                {hasUnmatchedOptions && (
                                  <span style={{ marginLeft: '10px', color: 'red', fontWeight: 'bold' }}>
                                    | 옵션명
                                  </span>
                                )}
                                {quantityIssues.hasInsufficient && (
                                  <span style={{ marginLeft: '10px', color: 'red', fontWeight: 'bold' }}>
                                    | 개수 부족
                                  </span>
                                )}
                                {quantityIssues.hasExcess && (
                                  <span style={{ marginLeft: '10px', color: 'red', fontWeight: 'bold' }}>
                                    | 개수 초과
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <button
                              onClick={() => handleImageReplace(siteUrl)}
                              style={{
                                padding: '6px 12px',
                                background: '#9C27B0',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px'
                              }}
                            >
                              {imageReplaced[siteUrl] ? '원본 이미지' : '이미지 교체'}
                            </button>
                            <select
                              className="china-order-cancel-reason-select"
                              value={cancelReasons[siteUrl] || ''}
                              onChange={(e) => setCancelReasons({...cancelReasons, [siteUrl]: e.target.value})}
                              style={{
                                padding: '6px 10px',
                                borderRadius: '4px',
                                border: '1px solid #ddd',
                                fontSize: '14px'
                              }}
                            >
                              <option value="">선택</option>
                              <option value="[취소] 📤 최소 주문 2개">[취소] 📤 최소 주문 2개</option>
                              <option value="[취소] 📤 최소 주문 3개">[취소] 📤 최소 주문 3개</option>
                              <option value="[취소] 🚫 링크 없음">[취소] 🚫 링크 없음</option>
                              <option value="[취소] 🅞 품절">[취소] 🅞 품절</option>
                              <option value="[취소] 🙌 이미지 ≠ 옵션명">[취소] 🙌 이미지 ≠ 옵션명</option>
                              <option value="[취소] ℳ 옵션명 없음">[취소] ℳ 옵션명 없음</option>
                              <option value="--------------------------" disabled>--------------------------</option>
                              <option value="[수정] 이미지 교체">[수정] 이미지 교체</option>
                            </select>
                            <button
                              onClick={() => handleCancelSelected(siteUrl)}
                              style={{
                                padding: '6px 12px',
                                background: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px'
                              }}
                            >
                              입력
                            </button>
                          </div>
                        </div>
                          <div className="china-order-table-board">
                            <table className="china-order-table">
                            <thead>
                              <tr>
                                <th>
                                  <input
                                    type="checkbox"
                                    checked={grouped[siteUrl].every(item => selectedRows.has(item.id))}
                                    onChange={(e) => handleBoardSelectAll(siteUrl, grouped[siteUrl], e.target.checked)}
                                    className="china-order-table-checkbox"
                                  />
                                </th>
                                <th>이미지</th>
                                <th>글번호</th>
                                <th>상품명</th>
                                <th>주문옵션</th>
                                <th>개수</th>
                                <th>위안</th>
                                <th>비고</th>
                                <th>확인</th>
                              </tr>
                            </thead>
                            <tbody>
                              {grouped[siteUrl].map((item) => {
                                const status = getVerificationStatus(item);
                                const qtyStatus = getQuantityStatus(item);
                                const isCanceled = item.cancelStatus && item.cancelStatus.includes('[취소]');

                                // 배경색 우선순위: 취소 > 개수 불일치 > 옵션 불일치 > 완전 일치
                                const backgroundColor =
                                  isCanceled ? '#ffcccc' :
                                  qtyStatus === 'insufficient' || qtyStatus === 'excess' ? '#ffe4b5' :
                                  status === 'offerId-only' ? '#ffe4b5' :
                                  status === 'matched' && qtyStatus === 'matched' ? '#d4edda' :
                                  'transparent';
                                return (
                                <tr key={item.id} style={{ backgroundColor }}>
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={selectedRows.has(item.id)}
                                      onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                                      className="china-order-table-checkbox"
                                    />
                                  </td>
                                  <td>
                                    {(() => {
                                      const imageUrl = getImageUrl(item, siteUrl);
                                      return imageUrl ? (
                                        <div className="china-order-image-preview-container">
                                          <img
                                            src={getProxyImageUrl(imageUrl)}
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
                                              src={getProxyImageUrl(imageUrl)}
                                              alt="상품 이미지 미리보기"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).src = '/placeholder.svg';
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="china-order-no-image">이미지 없음</div>
                                      );
                                    })()}
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
                                          {isSetProduct(item) && <span style={{ color: 'red', fontWeight: 'bold' }}>🧊 SET </span>}
                                          {item.columnC || ''}<br />
                                          {item.columnD || ''}<br />
                                          {item.columnF || ''}
                                        </a>
                                      ) : (
                                        <>
                                          {isSetProduct(item) && <span style={{ color: 'red', fontWeight: 'bold' }}>🧊 SET </span>}
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
                                  <td>
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
                                          style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'left'}}
                                        />
                                      ) : (
                                        item.note || ''
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <div
                                      onClick={() => handleCellEdit(item.id, 'cancelStatus')}
                                      style={{cursor: 'pointer', minHeight: '20px'}}
                                    >
                                      {editingCell?.id === item.id && editingCell?.field === 'cancelStatus' ? (
                                        <input
                                          type="text"
                                          value={cellValue}
                                          onChange={(e) => setCellValue(e.target.value)}
                                          onBlur={() => handleCellSave(item.id, 'cancelStatus')}
                                          onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'cancelStatus')}
                                          autoFocus
                                          style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'left'}}
                                        />
                                      ) : (
                                        item.cancelStatus || ''
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                              })}
                            </tbody>
                          </table>
                          </div>
                        </div>
                      );
                      })}
                      </>
                    )}
                  </div>
                );
              })()
            ) : (
              // 기본 모드 - 단일 테이블
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
                      <th>이미지</th>
                      <th>글번호</th>
                      <th>상품명</th>
                      <th>주문옵션</th>
                      <th>개수</th>
                      <th>위안</th>
                      <th>비고</th>
                      <th>확인</th>
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
                      paginatedData.map((item) => {
                        const status = getVerificationStatus(item);
                        const qtyStatus = getQuantityStatus(item);
                        const isCanceled = item.cancelStatus && item.cancelStatus.includes('[취소]');

                        // 배경색 우선순위: 취소 > 개수 불일치 > 옵션 불일치 > 완전 일치
                        const backgroundColor =
                          isCanceled ? '#ffcccc' :
                          qtyStatus === 'insufficient' || qtyStatus === 'excess' ? '#ffe4b5' :
                          status === 'offerId-only' ? '#ffe4b5' :
                          status === 'matched' && qtyStatus === 'matched' ? '#d4edda' :
                          'transparent';
                        return (
                        <tr key={item.id} style={{ backgroundColor }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRows.has(item.id)}
                              onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                              className="china-order-table-checkbox"
                            />
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
                                  {isSetProduct(item) && <span style={{ color: 'red', fontWeight: 'bold' }}>🧊 SET </span>}
                                  {item.columnC || ''}<br />
                                  {item.columnD || ''}<br />
                                  {item.columnF || ''}
                                </a>
                              ) : (
                                <>
                                  {isSetProduct(item) && <span style={{ color: 'red', fontWeight: 'bold' }}>🧊 SET </span>}
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
                          <td>
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
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'left'}}
                                />
                              ) : (
                                item.note || ''
                              )}
                            </div>
                          </td>
                          <td>
                            <div
                              onClick={() => handleCellEdit(item.id, 'cancelStatus')}
                              style={{cursor: 'pointer', minHeight: '20px'}}
                            >
                              {editingCell?.id === item.id && editingCell?.field === 'cancelStatus' ? (
                                <input
                                  type="text"
                                  value={cellValue}
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={() => handleCellSave(item.id, 'cancelStatus')}
                                  onKeyPress={(e) => e.key === 'Enter' && handleCellSave(item.id, 'cancelStatus')}
                                  autoFocus
                                  style={{width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'left'}}
                                />
                              ) : (
                                item.cancelStatus || ''
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
            )}
            
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