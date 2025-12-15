'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import './PaymentHistory.css';
import PaymentHistoryStatusCard from './PaymentHistoryStatusCard';

// 데이터 타입 정의 - invoiceManager_transactions 테이블
export interface PaymentHistoryData {
  id: string;
  order_code: string | null;
  user_id: string | null;
  transaction_type: string | null;
  description: string | null;
  admin_note: string | null;
  item_qty: number | null;
  amount: number | null;
  price: number | null;
  delivery_fee: number | null;
  service_fee: number | null;
  extra_fee: number | null;
  balance_after: number | null;
  status: string | null;
  date: string | null;  // YYYY-MM-DD 형식
  created_at: string | null;
  updated_at: string | null;
  delivery_status?: string | null;
  site_url?: string | null;
}

const PaymentHistory: React.FC = () => {
  const { t } = useTranslation();

  // 카드 데이터 정의
  const cardData = [
    { key: 'new', label: '신규' },
    { key: 'progress', label: '진행' },
    { key: 'cancel_received', label: '취소접수' },
    { key: 'cancel_completed', label: '취소완료' }
  ];

  // State 관리
  const [itemData, setItemData] = useState<PaymentHistoryData[]>([]);
  const [filteredData, setFilteredData] = useState<PaymentHistoryData[]>([]);
  const [loading, setLoading] = useState(false);
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string, user_code?: string, master_account?: string, user_id?: string}[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [activeStatus, setActiveStatus] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);

  // 날짜 편집 상태
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<string>('');

  // 검색 필터 상태
  const [periodType, setPeriodType] = useState<string>('30days');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchType, setSearchType] = useState<string>('all');

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<'charge' | 'deduct' | '1688order'>('charge');
  const [isSaving, setIsSaving] = useState(false);

  // 충전 폼 상태
  const [chargeForm, setChargeForm] = useState({
    description: '',
    amount: '',
    adminNote: ''
  });

  // 차감 폼 상태
  const [deductForm, setDeductForm] = useState({
    description: '',
    amount: '',
    itemQty: '',
    deliveryFee: '',
    serviceFee: '',
    extraFee: '',
    adminNote: ''
  });

  // 1688 주문 엑셀 업로드 상태
  const [orderExcelFile, setOrderExcelFile] = useState<File | null>(null);
  const [isUploadingOrderExcel, setIsUploadingOrderExcel] = useState(false);
  const orderExcelInputRef = useRef<HTMLInputElement>(null);

  const itemsPerPage = 20;

  // 날짜를 YYYY-MM-DD 형식으로 변환 (검색 필터용)
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // 현재 날짜를 YYYY-MM-DD 형식으로 반환 (DB 저장용)
  const getCurrentDate = (): string => {
    return formatDate(new Date());
  };

  // 기간 타입에 따라 시작/종료 날짜 계산
  const calculateDateRange = (type: string): { start: string; end: string } => {
    const today = new Date();
    const end = formatDate(today);
    let start = '';

    switch (type) {
      case '30days':
        const days30 = new Date(today);
        days30.setDate(today.getDate() - 30);
        start = formatDate(days30);
        break;
      case '3months':
        const months3 = new Date(today);
        months3.setMonth(today.getMonth() - 3);
        start = formatDate(months3);
        break;
      case '6months':
        const months6 = new Date(today);
        months6.setMonth(today.getMonth() - 6);
        start = formatDate(months6);
        break;
      case '1year':
        const year1 = new Date(today);
        year1.setFullYear(today.getFullYear() - 1);
        start = formatDate(year1);
        break;
      case 'all':
        start = '';
        break;
      default:
        start = formatDate(new Date(today.setDate(today.getDate() - 30)));
    }

    return { start, end: type === 'all' ? '' : end };
  };

  // 기간 드롭박스 변경 핸들러
  const handlePeriodChange = (type: string) => {
    setPeriodType(type);
    const { start, end } = calculateDateRange(type);
    setStartDate(start);
    setEndDate(end);
  };

  // 초기 날짜 설정 (최근 30일)
  useEffect(() => {
    const { start, end } = calculateDateRange('30days');
    setStartDate(start);
    setEndDate(end);
  }, []);

  // 상태별 카운트 계산 함수
  const getStatusCount = (statusKey: string): number => {
    if (statusKey === 'all') {
      return itemData.length;
    }
    if (statusKey === 'unmatched') {
      return itemData.filter(item => !item.delivery_status).length;
    }
    return itemData.filter(item => item.delivery_status === statusKey).length;
  };

  // 상태별 필터링 함수
  const filterByStatus = (statusKey: string): PaymentHistoryData[] => {
    if (statusKey === 'all') {
      return itemData;
    }
    if (statusKey === 'unmatched') {
      return itemData.filter(item => !item.delivery_status);
    }
    return itemData.filter(item => item.delivery_status === statusKey);
  };

  // 쿠팡 사용자 목록 가져오기
  const fetchCoupangUsers = async () => {
    try {
      console.log('쿠팡 사용자 목록 가져오기 시작...');
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      if (result.success && result.data) {
        setCoupangUsers(result.data);
      } else {
        console.warn('쿠팡 사용자 데이터를 가져오지 못했습니다:', result);
      }
    } catch (error) {
      console.error('쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  useEffect(() => {
    fetchCoupangUsers();
  }, []);

  // 드롭다운 선택 시 상태 초기화
  useEffect(() => {
    if (!selectedCoupangUser) {
      setHasLoadedData(false);
      setItemData([]);
      setFilteredData([]);
      setBalance(null);
      setLiveBalance(null);
    }
  }, [selectedCoupangUser]);

  // 잔액 조회
  const fetchBalance = async (masterAccount: string) => {
    try {
      const response = await fetch(`/api/get-invoice-balance?master_account=${encodeURIComponent(masterAccount)}`);
      const result = await response.json();

      if (result.success) {
        setBalance(result.balance);
        console.log('잔액 조회 성공:', result.balance);
      } else {
        console.warn('잔액 조회 실패:', result.error);
        setBalance(null);
      }
    } catch (error) {
      console.error('잔액 조회 오류:', error);
      setBalance(null);
    }
  };

  // 라이브 잔액 조회 (master_account 사용)
  const fetchLiveBalance = async (masterAccount: string) => {
    try {
      const response = await fetch(`/api/get-live-balance?master_account=${encodeURIComponent(masterAccount)}`);
      const result = await response.json();

      if (result.success) {
        setLiveBalance(result.liveBalance);
        console.log('라이브 잔액 조회 성공:', result.liveBalance);
      } else {
        console.warn('라이브 잔액 조회 실패:', result.error);
        setLiveBalance(null);
      }
    } catch (error) {
      console.error('라이브 잔액 조회 오류:', error);
      setLiveBalance(null);
    }
  };

  // 트랜잭션 데이터 조회
  const fetchTransactions = async (userId: string) => {
    try {
      const params = new URLSearchParams({ user_id: userId });
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (searchType !== 'all') params.append('transaction_type', searchType);

      const response = await fetch(`/api/get-payment-transactions?${params}`);
      const result = await response.json();

      if (result.success) {
        setItemData(result.data);
        setFilteredData(result.data);
      } else {
        console.error('트랜잭션 조회 실패:', result.error);
      }
    } catch (error) {
      console.error('트랜잭션 조회 오류:', error);
    }
  };

  // 업데이트 버튼 - 잔액 + 라이브 잔액 + 트랜잭션 조회
  const handleUpdate = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser) {
      alert('선택한 사용자 정보를 찾을 수 없습니다.');
      return;
    }

    if (!selectedUser.user_id) {
      alert('선택한 사용자의 user_id 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setLoading(true);

      if (selectedUser.master_account) {
        await fetchBalance(selectedUser.master_account);
        await fetchLiveBalance(selectedUser.master_account);
      }

      // 트랜잭션 조회 (user_id 사용)
      await fetchTransactions(selectedUser.user_id);
      setHasLoadedData(true);

      setLoading(false);
    } catch (error) {
      console.error('업데이트 오류:', error);
      alert(`업데이트 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setLoading(false);
    }
  };

  // 전체 선택/해제
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems(new Set());
      setSelectAll(false);
    } else {
      const allIds = new Set(paginatedData.map(item => item.id));
      setSelectedItems(allIds);
      setSelectAll(true);
    }
  };

  // 개별 선택/해제
  const handleSelectItem = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
      setSelectAll(false);
    } else {
      newSelected.add(itemId);
      // 현재 페이지의 모든 항목이 선택되었는지 확인
      if (newSelected.size === paginatedData.length &&
          paginatedData.every(item => newSelected.has(item.id))) {
        setSelectAll(true);
      }
    }
    setSelectedItems(newSelected);
  };

  // 검색 기능 - API 호출로 필터링
  const handleSearchClick = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.user_id) return;

    setLoading(true);
    try {
      // API 호출하여 데이터 가져오기
      const params = new URLSearchParams({ user_id: selectedUser.user_id });
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (searchType !== 'all') params.append('transaction_type', searchType);

      const response = await fetch(`/api/get-payment-transactions?${params}`);
      const result = await response.json();

      if (result.success) {
        const fetchedData = result.data;
        setItemData(fetchedData);

        // 검색어가 있으면 클라이언트에서 추가 필터링
        if (searchTerm.trim()) {
          const searchLower = searchTerm.toLowerCase().trim();
          const filtered = fetchedData.filter((item: PaymentHistoryData) =>
            item.description?.toLowerCase().includes(searchLower) ||
            item.transaction_type?.toLowerCase().includes(searchLower)
          );
          setFilteredData(filtered);
        } else {
          // 검색어가 없으면 전체 데이터 표시
          setFilteredData(fetchedData);
        }
      } else {
        console.error('트랜잭션 조회 실패:', result.error);
      }

      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchClick();
    }
  };

  // 페이지네이션
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handlePageChange = (pageNum: number) => {
    setCurrentPage(pageNum);
  };

  // 마우스 위치 추적
  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  };

  // 상태 카드 클릭 핸들러
  const handleStatusCardClick = (statusKey: string) => {
    setActiveStatus(statusKey);
    setSearchTerm('');
    const filtered = filterByStatus(statusKey);
    setFilteredData(filtered);
    setCurrentPage(1);
  };

  // 비용 클릭 시 URL 열기
  const handleCostClick = (e: React.MouseEvent, item: PaymentHistoryData) => {
    e.preventDefault();
    e.stopPropagation();

    // site_url이 있으면 바로 열기
    if (item.site_url && item.site_url.trim()) {
      let fullUrl = item.site_url.trim();
      if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
        fullUrl = 'https://' + fullUrl;
      }
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
      window.open(fullUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // 날짜 포맷 함수
  const formatDateTime = (dateStr: string | null): string => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('ko-KR');
  };

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = async () => {
    if (filteredData.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    try {
      const XLSX = await import('xlsx');

      // 금액 표시 헬퍼 함수 (차감일 경우 마이너스 표시)
      const formatAmountForExcel = (amount: number | null, transactionType: string | null): number | string => {
        if (amount === null || amount === undefined) return '';
        return transactionType === '차감' ? -amount : amount;
      };

      // 테이블 컬럼 순서대로 데이터 변환
      const excelData = filteredData.map((item) => ({
        '업체': item.user_id || '',
        '주문코드': item.order_code || '',
        '타입': item.transaction_type || '',
        '내용': item.description || '',
        '수량': item.item_qty ?? '',
        '총금액': formatAmountForExcel(item.amount, item.transaction_type),
        '금액': formatAmountForExcel(item.price, item.transaction_type),
        '배송비': formatAmountForExcel(item.delivery_fee, item.transaction_type),
        '서비스비': formatAmountForExcel(item.service_fee, item.transaction_type),
        '기타비용': formatAmountForExcel(item.extra_fee, item.transaction_type),
        '잔액': item.balance_after ?? '',
        '상태': item.status || '',
        '관리자비고': item.admin_note || '',
        '날짜': item.date || '',
      }));

      // 워크북 생성
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '결제내역');

      // 파일명: 결제내역_업체명_시작일~종료일.xlsx
      const dateRange = startDate && endDate ? `${startDate}~${endDate}` : new Date().toISOString().slice(0, 10);
      const fileName = `결제내역_${selectedCoupangUser}_${dateRange}.xlsx`;
      XLSX.writeFile(workbook, fileName);

    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 모달 닫기 및 폼 초기화
  const handleCloseModal = () => {
    setShowAddModal(false);
    setChargeForm({ description: '', amount: '', adminNote: '' });
    setDeductForm({ description: '', amount: '', itemQty: '', deliveryFee: '', serviceFee: '', extraFee: '', adminNote: '' });
    setOrderExcelFile(null);
    if (orderExcelInputRef.current) orderExcelInputRef.current.value = '';
  };

  // 충전 저장 핸들러
  const handleSaveCharge = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    if (!chargeForm.amount || Number(chargeForm.amount) <= 0) {
      alert('금액을 입력해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.master_account || !selectedUser.user_id) {
      alert('선택한 사용자의 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch('/api/save-payment-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          master_account: selectedUser.master_account,
          transaction_type: '충전',
          description: chargeForm.description || null,
          amount: Number(chargeForm.amount),
          admin_note: chargeForm.adminNote || null,
          date: getCurrentDate()
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('충전이 완료되었습니다.');
        setBalance(result.newBalance);
        await fetchTransactions(selectedUser.user_id);
        if (selectedUser.master_account) {
          await fetchLiveBalance(selectedUser.master_account);
        }
        handleCloseModal();
      } else {
        alert(`저장 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('충전 저장 오류:', error);
      alert('충전 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 차감 저장 핸들러
  const handleSaveDeduct = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    if (!deductForm.amount || Number(deductForm.amount) <= 0) {
      alert('전체금액을 입력해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.master_account || !selectedUser.user_id) {
      alert('선택한 사용자의 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch('/api/save-payment-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          master_account: selectedUser.master_account,
          transaction_type: '차감',
          description: deductForm.description || null,
          amount: Number(deductForm.amount),
          item_qty: deductForm.itemQty ? Number(deductForm.itemQty) : null,
          delivery_fee: deductForm.deliveryFee ? Number(deductForm.deliveryFee) : null,
          service_fee: deductForm.serviceFee ? Number(deductForm.serviceFee) : null,
          extra_fee: deductForm.extraFee ? Number(deductForm.extraFee) : null,
          admin_note: deductForm.adminNote || null,
          date: getCurrentDate()
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('차감이 완료되었습니다.');
        setBalance(result.newBalance);
        await fetchTransactions(selectedUser.user_id);
        if (selectedUser.master_account) {
          await fetchLiveBalance(selectedUser.master_account);
        }
        handleCloseModal();
      } else {
        alert(`저장 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('차감 저장 오류:', error);
      alert('차감 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 1688 주문 엑셀 파일 선택 핸들러
  const handleOrderExcelSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
        return;
      }
      setOrderExcelFile(file);
    }
  };

  // AD열에서 order_code 추출 함수
  const extractOrderCodes = (adValue: string): string[] => {
    if (!adValue) return [];
    const lines = adValue.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const parts = line.split('//');
      return parts[0]?.trim() || '';
    }).filter(code => code);
  };

  // 1688 주문 엑셀 저장 핸들러
  const handleSave1688Order = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    if (!orderExcelFile) {
      alert('엑셀 파일을 선택해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.master_account || !selectedUser.user_id) {
      alert('선택한 사용자의 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setIsUploadingOrderExcel(true);
      const XLSX = await import('xlsx');

      // 엑셀 파일 읽기
      const arrayBuffer = await orderExcelFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // 시트를 배열로 변환 (header 포함)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as (string | number)[][];

      if (jsonData.length < 2) {
        alert('엑셀 파일에 데이터가 없습니다.');
        return;
      }

      // 열 인덱스 (0-based): G=6, I=8, U=20, AD=29
      const COL_DELIVERY_FEE = 6;  // G열 배송비
      const COL_TOTAL_AMOUNT = 8;  // I열 총금액
      const COL_ITEM_QTY = 20;     // U열 수량
      const COL_PRODUCT_INFO = 29; // AD열 상품정보

      // 데이터 행만 처리 (1행은 헤더)
      const dataRows = jsonData.slice(1);

      // 모든 order_code 수집 및 검증
      const allOrderCodes: string[] = [];
      for (const row of dataRows) {
        const adValue = String(row[COL_PRODUCT_INFO] || '');
        const codes = extractOrderCodes(adValue);
        allOrderCodes.push(...codes);
      }

      // order_code가 모두 동일한지 검증
      const uniqueOrderCodes = [...new Set(allOrderCodes.filter(code => code))];
      if (uniqueOrderCodes.length === 0) {
        alert('AD열에서 주문번호를 찾을 수 없습니다.');
        return;
      }
      if (uniqueOrderCodes.length > 1) {
        console.log(uniqueOrderCodes.join(', '));
        alert(`주문번호가 다른 주문이 포함되어 있습니다.\n발견된 주문번호: ${uniqueOrderCodes.join(', ')}\n\n엑셀파일을 확인해주세요.`);
        return;
      }

      const orderCode = uniqueOrderCodes[0];

      // 합계 계산 (병합 셀 고려 - 값이 있는 셀만 합산)
      let totalDeliveryFee = 0;
      let totalAmount = 0;
      let totalItemQty = 0;

      for (const row of dataRows) {
        // 배송비 (G열) - 병합된 셀은 값이 있는 첫 행만 값이 있음
        const deliveryFee = Number(row[COL_DELIVERY_FEE]) || 0;
        if (deliveryFee > 0) totalDeliveryFee += deliveryFee;

        // 총금액 (I열) - 병합된 셀은 값이 있는 첫 행만 값이 있음
        const amount = Number(row[COL_TOTAL_AMOUNT]) || 0;
        if (amount > 0) totalAmount += amount;

        // 수량 (U열) - 각 행마다 있음
        const itemQty = Number(row[COL_ITEM_QTY]) || 0;
        totalItemQty += itemQty;
      }

      // 금액 계산
      const price = totalAmount - totalDeliveryFee;  // 구매비용 (I열 합 - 배송비)
      const serviceFee = Math.round(price * 0.05);   // 서비스비용 (구매비용 * 5%)
      const finalAmount = totalAmount + serviceFee;  // 최종 차감 금액 (I열 합 + 서비스비)

      // description 생성
      const description = `${orderCode} 주문`;

      // API 호출하여 저장
      const response = await fetch('/api/save-payment-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUser.user_id,
          master_account: selectedUser.master_account,
          order_code: orderCode,
          transaction_type: '차감',
          description,
          item_qty: totalItemQty,
          amount: finalAmount,
          delivery_fee: totalDeliveryFee,
          service_fee: serviceFee,
          extra_fee: null,
          price,
          status: '정상',
          admin_note: null,
          date: getCurrentDate()
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`1688 주문이 저장되었습니다.\n주문번호: ${orderCode}\n수량: ${totalItemQty}개\n차감금액: ${finalAmount.toLocaleString()}원`);
        setBalance(result.newBalance);
        await fetchTransactions(selectedUser.user_id);
        if (selectedUser.master_account) {
          await fetchLiveBalance(selectedUser.master_account);
        }
        setOrderExcelFile(null);
        if (orderExcelInputRef.current) orderExcelInputRef.current.value = '';
        handleCloseModal();
      } else {
        alert(`저장 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('1688 주문 엑셀 처리 오류:', error);
      alert('1688 주문 엑셀 처리 중 오류가 발생했습니다.');
    } finally {
      setIsUploadingOrderExcel(false);
    }
  };

  // 저장 버튼 클릭 핸들러
  const handleSave = () => {
    if (addModalType === 'charge') {
      handleSaveCharge();
    } else if (addModalType === 'deduct') {
      handleSaveDeduct();
    } else if (addModalType === '1688order') {
      handleSave1688Order();
    }
  };

  // 날짜 편집 핸들러
  const handleDateClick = (item: PaymentHistoryData) => {
    setEditingDateId(item.id);
    setEditingDateValue(item.date || getCurrentDate());
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingDateValue(e.target.value);
  };

  const handleDateCancel = () => {
    setEditingDateId(null);
    setEditingDateValue('');
  };

  const handleDateSave = async (itemId: string) => {
    try {
      const response = await fetch('/api/update-payment-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: itemId,
          date: editingDateValue
        })
      });

      const result = await response.json();

      if (result.success) {
        // 로컬 데이터 업데이트
        const updatedData = itemData.map(item =>
          item.id === itemId ? { ...item, date: editingDateValue } : item
        );
        setItemData(updatedData);
        setFilteredData(updatedData);
        setEditingDateId(null);
        setEditingDateValue('');
      } else {
        alert(`날짜 수정 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('날짜 수정 오류:', error);
      alert('날짜 수정 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="payment-history-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="payment-history-main-content">
        <LeftsideMenu />
        <main className="payment-history-content">
          <div className="payment-history-container">
            {/* 타이틀 행 - 왼쪽: 제목, 오른쪽: 사용자 선택 및 업데이트 */}
            <div className="payment-history-title-row">
              <h1 className="payment-history-title">결제내역</h1>
              <div className="payment-history-title-controls">
                <select
                  className="payment-history-user-dropdown"
                  value={selectedCoupangUser}
                  onChange={(e) => setSelectedCoupangUser(e.target.value)}
                >
                  <option value="">{t('importProduct.selectUser')}</option>
                  {coupangUsers.map((user) => {
                    const cacheKey = `sheet_data_${user.coupang_name}`;
                    const hasCachedData = localStorage.getItem(cacheKey) !== null;
                    const displayName = user.user_code
                      ? `${user.user_code} ${user.coupang_name}`
                      : user.coupang_name;

                    return (
                      <option key={user.coupang_name} value={user.coupang_name}>
                        {displayName} {hasCachedData ? '●' : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  className="payment-history-upload-btn"
                  onClick={handleUpdate}
                  disabled={!selectedCoupangUser || loading}
                >
                  {loading ? (
                    <span className="payment-history-button-loading">
                      <span className="payment-history-spinner"></span>
                      {t('importProduct.refresh')}
                    </span>
                  ) : (
                    t('importProduct.refresh')
                  )}
                </button>
                <button
                  className="payment-history-download-btn"
                  onClick={handleExcelDownload}
                  disabled={filteredData.length === 0}
                >
                  엑셀 다운로드
                </button>
                <button
                  className="payment-history-add-btn"
                  onClick={() => setShowAddModal(true)}
                  disabled={!hasLoadedData}
                >
                  추가
                </button>
              </div>
            </div>

            {/* 잔액 보드 */}
            <div className="payment-history-balance-section">
              <div className="payment-history-balance-board">
                <div className="payment-history-balance-item">
                  <span className="payment-history-balance-label">잔액:</span>
                  <span className="payment-history-balance-value">
                    {balance !== null ? balance.toLocaleString() : '-'}
                  </span>
                </div>
                <div className="payment-history-balance-divider"></div>
                <div className="payment-history-balance-item">
                  <span className="payment-history-balance-label">라이브 잔액:</span>
                  <span className="payment-history-balance-value">
                    {liveBalance !== null ? liveBalance.toLocaleString() : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* 상태 카드들 */}
            <div className="payment-history-status-cards">
              {cardData.map((statusCard, index) => {
                const count = getStatusCount(statusCard.key);
                const isActive = activeStatus === statusCard.key;

                return (
                  <PaymentHistoryStatusCard
                    key={index}
                    label={statusCard.label}
                    count={count}
                    isActive={isActive}
                    onClick={() => handleStatusCardClick(statusCard.key)}
                  />
                );
              })}
            </div>

            {/* 검색 영역 */}
            <div className="payment-history-search-section">
              <div className="payment-history-search-board">
                <div className="payment-history-search-form-wrapper">
                  {/* 검색폼 2줄 컨테이너 */}
                  <div className="payment-history-search-rows">
                    {/* 1줄: 기간 드롭박스, 시작날짜, 종료날짜 */}
                    <div className="payment-history-search-row">
                      <select
                        className="payment-history-search-dropdown"
                        value={periodType}
                        onChange={(e) => handlePeriodChange(e.target.value)}
                      >
                        <option value="30days">최근 30일</option>
                        <option value="3months">최근 3개월</option>
                        <option value="6months">최근 6개월</option>
                        <option value="1year">최근 1년</option>
                        <option value="all">전체</option>
                      </select>
                      <input
                        type="date"
                        className="payment-history-date-input"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                      <input
                        type="date"
                        className="payment-history-date-input"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </div>
                    {/* 2줄: 타입 드롭박스, 검색입력폼 */}
                    <div className="payment-history-search-row">
                      <select
                        className="payment-history-search-dropdown"
                        value={searchType}
                        onChange={(e) => setSearchType(e.target.value)}
                      >
                        <option value="all">전체</option>
                        <option value="충전">충전</option>
                        <option value="차감">차감</option>
                      </select>
                      <input
                        type="text"
                        className="payment-history-search-input"
                        placeholder="검색어를 입력하세요"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyPress={handleSearchKeyPress}
                      />
                    </div>
                  </div>
                  {/* 검색 버튼 (2줄 높이) */}
                  <button className="payment-history-search-button" onClick={handleSearchClick}>
                    {t('importProduct.search')}
                  </button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div className="payment-history-table-board">
              {loading ? (
                <div className="payment-history-empty-data">{t('importProduct.table.loading')}</div>
              ) : (
                <table className="payment-history-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={handleSelectAll}
                          className="payment-history-table-checkbox"
                        />
                      </th>
                      <th>타입</th>
                      <th>내용</th>
                      <th>수량</th>
                      <th>금액</th>
                      <th>정리</th>
                      <th>상태</th>
                      <th>날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="payment-history-empty-data">
                          {t('importProduct.table.noData')}
                        </td>
                      </tr>
                    ) : (
                      paginatedData.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => handleSelectItem(item.id)}
                              className="payment-history-table-checkbox"
                            />
                          </td>
                          <td>
                            <span className={`payment-history-type-badge ${item.transaction_type === '충전' ? 'charge' : item.transaction_type === '차감' ? 'deduct' : ''}`}>
                              {item.transaction_type || '-'}
                            </span>
                          </td>
                          <td>
                            {item.description || '-'}
                            {item.admin_note && (
                              <>
                                <br />
                                <span className="payment-history-admin-note">
                                  {item.admin_note}
                                </span>
                              </>
                            )}
                          </td>
                          <td>{item.item_qty ?? '-'}</td>
                          <td>
                            {item.amount?.toLocaleString() ?? '-'}
                            {item.balance_after != null && (
                              <>
                                <br />
                                <span className="payment-history-balance-after">
                                  ({item.balance_after.toLocaleString()})
                                </span>
                              </>
                            )}
                          </td>
                          <td>
                            {item.transaction_type === '차감' && (item.price || item.delivery_fee || item.service_fee || item.extra_fee) ? (
                              <span className="payment-history-fee-info">
                                {item.price ? `금액:${item.price.toLocaleString()}` : ''}
                                {item.price && (item.delivery_fee || item.service_fee || item.extra_fee) ? ' / ' : ''}
                                {item.delivery_fee ? `배송:${item.delivery_fee.toLocaleString()}` : ''}
                                {item.delivery_fee && (item.service_fee || item.extra_fee) ? ' / ' : ''}
                                {item.service_fee ? `서비스:${item.service_fee.toLocaleString()}` : ''}
                                {item.service_fee && item.extra_fee ? ' / ' : ''}
                                {item.extra_fee ? `기타:${item.extra_fee.toLocaleString()}` : ''}
                              </span>
                            ) : '-'}
                          </td>
                          <td>{item.status || '-'}</td>
                          <td className="payment-history-date-cell">
                            {editingDateId === item.id ? (
                              <div className="payment-history-date-edit">
                                <input
                                  type="date"
                                  className="payment-history-date-input"
                                  value={editingDateValue}
                                  onChange={handleDateChange}
                                  autoFocus
                                />
                                <div className="payment-history-date-buttons">
                                  <button
                                    className="payment-history-date-save-btn"
                                    onClick={() => handleDateSave(item.id)}
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className="payment-history-date-cancel-btn"
                                    onClick={handleDateCancel}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span
                                className="payment-history-date-text"
                                onClick={() => handleDateClick(item)}
                              >
                                {item.date || '-'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* 페이지네이션 */}
            {!loading && filteredData.length > 0 && (
              <div className="payment-history-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="payment-history-pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>

                <div className="payment-history-page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`payment-history-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="payment-history-pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="payment-history-page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 추가 모달 */}
      {showAddModal && (
        <div className="payment-history-modal-overlay" onClick={handleCloseModal}>
          <div className="payment-history-modal" onClick={(e) => e.stopPropagation()}>
            {/* 모달 타이틀 */}
            <div className="payment-history-modal-title">결제 추가</div>

            {/* 타입 선택 버튼 */}
            <div className="payment-history-modal-type-buttons">
              <button
                className={`payment-history-modal-type-btn charge ${addModalType === 'charge' ? 'active' : ''}`}
                onClick={() => setAddModalType('charge')}
              >
                충전
              </button>
              <button
                className={`payment-history-modal-type-btn deduct ${addModalType === 'deduct' ? 'active' : ''}`}
                onClick={() => setAddModalType('deduct')}
              >
                차감
              </button>
              <button
                className={`payment-history-modal-type-btn order ${addModalType === '1688order' ? 'active' : ''}`}
                onClick={() => setAddModalType('1688order')}
              >
                1688 주문
              </button>
            </div>

            {/* 모달 컨텐츠 영역 */}
            <div className="payment-history-modal-content">
              {/* 충전 폼 */}
              {addModalType === 'charge' && (
                <div className="payment-history-modal-form-deduct">
                  {/* 항목 - 1줄 */}
                  <div className="form-row-single">
                    <div className="form-item">
                      <label>항목</label>
                      <input
                        type="text"
                        placeholder="항목을 입력하세요"
                        value={chargeForm.description}
                        onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                      />
                    </div>
                  </div>
                  {/* 전체금액 - 1줄 */}
                  <div className="form-row-single">
                    <div className="form-item">
                      <label>전체금액</label>
                      <input
                        type="number"
                        placeholder="(배송비, 서비스, 기타.. 모든 비용 포함)"
                        value={chargeForm.amount}
                        onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                      />
                    </div>
                  </div>
                  {/* 관리자 비고 - 1줄 */}
                  <div className="form-row-single">
                    <div className="form-item">
                      <label>관리자 비고</label>
                      <textarea
                        placeholder="비고를 입력하세요"
                        rows={3}
                        value={chargeForm.adminNote}
                        onChange={(e) => setChargeForm({ ...chargeForm, adminNote: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 차감 폼 */}
              {addModalType === 'deduct' && (
                <div className="payment-history-modal-form-deduct">
                  {/* 항목 - 1줄 */}
                  <div className="form-row-single">
                    <div className="form-item">
                      <label>항목</label>
                      <input
                        type="text"
                        placeholder="항목을 입력하세요"
                        value={deductForm.description}
                        onChange={(e) => setDeductForm({ ...deductForm, description: e.target.value })}
                      />
                    </div>
                  </div>
                  {/* 전체금액, 수량 - 1/2씩 */}
                  <div className="form-row-half">
                    <div className="form-item">
                      <label>전체금액</label>
                      <input
                        type="number"
                        placeholder="(배송비, 서비스, 기타.. 모든 비용 포함)"
                        value={deductForm.amount}
                        onChange={(e) => setDeductForm({ ...deductForm, amount: e.target.value })}
                      />
                    </div>
                    <div className="form-item">
                      <label>수량</label>
                      <input
                        type="number"
                        placeholder="수량"
                        value={deductForm.itemQty}
                        onChange={(e) => setDeductForm({ ...deductForm, itemQty: e.target.value })}
                      />
                    </div>
                  </div>
                  {/* 배송비, 서비스비용, 기타비용 - 1/3씩 */}
                  <div className="form-row-third">
                    <div className="form-item">
                      <label>배송비</label>
                      <input
                        type="number"
                        placeholder="배송비"
                        value={deductForm.deliveryFee}
                        onChange={(e) => setDeductForm({ ...deductForm, deliveryFee: e.target.value })}
                      />
                    </div>
                    <div className="form-item">
                      <label>서비스</label>
                      <input
                        type="number"
                        placeholder="서비스비용"
                        value={deductForm.serviceFee}
                        onChange={(e) => setDeductForm({ ...deductForm, serviceFee: e.target.value })}
                      />
                    </div>
                    <div className="form-item">
                      <label>기타</label>
                      <input
                        type="number"
                        placeholder="기타비용"
                        value={deductForm.extraFee}
                        onChange={(e) => setDeductForm({ ...deductForm, extraFee: e.target.value })}
                      />
                    </div>
                  </div>
                  {/* 관리자 비고 - 1줄 */}
                  <div className="form-row-single">
                    <div className="form-item">
                      <label>관리자 비고</label>
                      <textarea
                        placeholder="비고를 입력하세요"
                        rows={3}
                        value={deductForm.adminNote}
                        onChange={(e) => setDeductForm({ ...deductForm, adminNote: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 1688 주문 - 엑셀 업로드 */}
              {addModalType === '1688order' && (
                <div className="payment-history-modal-upload">
                  <input
                    type="file"
                    id="modal-excel-upload"
                    ref={orderExcelInputRef}
                    accept=".xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={handleOrderExcelSelect}
                  />
                  <label htmlFor="modal-excel-upload" className="payment-history-modal-upload-area">
                    <div className="payment-history-modal-upload-icon">
                      {orderExcelFile ? '✅' : '📁'}
                    </div>
                    <div className="payment-history-modal-upload-text">
                      {orderExcelFile ? orderExcelFile.name : '클릭하여 엑셀 파일을 선택하세요'}
                    </div>
                    <div className="payment-history-modal-upload-hint">
                      {orderExcelFile ? '다른 파일을 선택하려면 클릭하세요' : '.xlsx, .xls 파일만 업로드 가능합니다'}
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* 모달 푸터 - 취소/저장 버튼 */}
            <div className="payment-history-modal-footer">
              <div className="payment-history-modal-footer-buttons">
                <button
                  className="payment-history-modal-cancel-btn"
                  onClick={handleCloseModal}
                >
                  취소
                </button>
                <button
                  className="payment-history-modal-save-btn"
                  onClick={handleSave}
                  disabled={isSaving || isUploadingOrderExcel}
                >
                  {(isSaving || isUploadingOrderExcel) ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentHistory;
