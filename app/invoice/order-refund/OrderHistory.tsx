'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import OrderHistoryStatusCard from './OrderHistoryStatusCard';
import './OrderHistory.css';

// 데이터 타입 정의 - invoiceManager_refundOrder 테이블
export interface RefundOrderData {
  id: string;
  order_number: string | null;
  product_name: string | null;
  option_name_cn: string | null;
  qty: number | null;
  refund_amount: number | null;
  product_price: number | null;
  refund_type: string | null;
  refund_description: string | null;
  refund_status: string | null;
  '1688_order_number': string | null;
  site_url: string | null;
  img_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  confirm_date: string | null;
  delivery_fee: number | null;
  service_fee: number | null;
}

const OrderHistory: React.FC = () => {
  const { t } = useTranslation();

  // State 관리
  const [itemData, setItemData] = useState<RefundOrderData[]>([]);
  const [filteredData, setFilteredData] = useState<RefundOrderData[]>([]);
  const [loading, setLoading] = useState(false);
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string, user_code?: string, master_account?: string, user_id?: string}[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const [editingProductPrice, setEditingProductPrice] = useState<{[key: string]: number | null}>({});
  const [editingRefundDescription, setEditingRefundDescription] = useState<{[key: string]: string}>({});
  const [editingDeliveryFee, setEditingDeliveryFee] = useState<{[key: string]: number | null}>({});
  const [editingServiceFee, setEditingServiceFee] = useState<{[key: string]: number | null}>({});
  const [editingConfirmDate, setEditingConfirmDate] = useState<{[key: string]: string}>({});
  const [focusedDateCell, setFocusedDateCell] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(30);
  const [show1688Only, setShow1688Only] = useState(false);

  // 상태 카드 데이터 (key: DB의 refund_status 값)
  const cardData = [
    { key: 'all', label: '전체' },
    { key: '접수', label: '환불접수' },
    { key: '진행', label: '환불진행중' },
    { key: '완료', label: '환불완료' },
    { key: '취소', label: '취소' }
  ];

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
      } else {
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

  // 환불 주문 데이터 조회
  const fetchRefundOrders = async (userId: string, keepActiveStatus: boolean = false) => {
    try {
      const response = await fetch(`/api/get-refund-orders?user_id=${encodeURIComponent(userId)}`);
      const result = await response.json();

      if (result.success) {
        setItemData(result.data);

        // 필터 적용
        const statusToUse = keepActiveStatus ? activeStatus : 'all';
        const filtered = applyFilters(result.data, statusToUse, show1688Only);
        setFilteredData(filtered);
      } else {
        console.error('환불 주문 조회 실패:', result.error);
        setItemData([]);
        setFilteredData([]);
      }
    } catch (error) {
      console.error('환불 주문 조회 오류:', error);
      setItemData([]);
      setFilteredData([]);
    }
  };

  // 불러오기 버튼 - 잔액 + 환불 주문 조회
  const handleLoad = async () => {
    if (!selectedCoupangUser) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser || !selectedUser.user_id) {
      alert('선택한 사용자 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setLoading(true);

      // 잔액 및 라이브 잔액 조회
      if (selectedUser.master_account) {
        await fetchBalance(selectedUser.master_account);
        await fetchLiveBalance(selectedUser.master_account);
      }

      // 환불 주문 조회
      await fetchRefundOrders(selectedUser.user_id);
      setHasLoadedData(true);

    } catch (error) {
      console.error('불러오기 오류:', error);
      alert(`불러오기 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  // 업데이트 버튼 - 구글 시트 '취소내역' 데이터를 supabase에 추가
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

    if (!selectedUser.googlesheet_id) {
      alert('해당 사용자의 구글 시트 ID가 없습니다.');
      return;
    }

    if (!selectedUser.user_id) {
      alert('해당 사용자의 user_id가 없습니다.');
      return;
    }

    try {
      setLoading(true);

      const response = await fetch('/api/sync-refund-orders-from-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googlesheet_id: selectedUser.googlesheet_id,
          user_id: selectedUser.user_id,
          master_account: selectedUser.master_account || null,
        }),
      });

      const result = await response.json();

      if (result.success) {
        let message = result.message;
        if (result.added > 0 || result.skipped > 0) {
          message += `\n\n추가: ${result.added}건\n스킵(기존): ${result.skipped}건`;
        }
        alert(message);

        // 데이터 새로고침
        if (selectedUser.user_id) {
          await fetchRefundOrders(selectedUser.user_id, true);
        }
      } else {
        alert(`업데이트 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('업데이트 오류:', error);
      alert('업데이트 중 오류가 발생했습니다.');
    } finally {
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
      if (newSelected.size === paginatedData.length &&
          paginatedData.every(item => newSelected.has(item.id))) {
        setSelectAll(true);
      }
    }
    setSelectedItems(newSelected);
  };

  // 상태별 카운트 계산
  const getStatusCount = (statusKey: string): number => {
    if (statusKey === 'all') return itemData.length;
    return itemData.filter(item => item.refund_status === statusKey).length;
  };

  // 데이터 필터링 공통 함수
  const applyFilters = (data: RefundOrderData[], statusKey: string, only1688: boolean): RefundOrderData[] => {
    let filtered = data;

    // 1. 상태 필터
    if (statusKey !== 'all') {
      filtered = filtered.filter(item => item.refund_status === statusKey);
    }

    // 2. 1688 주문번호 필터
    if (only1688) {
      filtered = filtered.filter(item => item['1688_order_number'] && item['1688_order_number'].trim() !== '');
    }

    return filtered;
  };

  // 상태 카드 클릭 핸들러
  const handleStatusCardClick = (statusKey: string) => {
    setActiveStatus(statusKey);
    const filtered = applyFilters(itemData, statusKey, show1688Only);
    setFilteredData(filtered);
    setCurrentPage(1);
  };

  // 검색 기능
  const handleSearchClick = () => {
    if (!searchTerm.trim()) {
      const filtered = applyFilters(itemData, activeStatus, show1688Only);
      setFilteredData(filtered);
      setCurrentPage(1);
      return;
    }

    const searchLower = searchTerm.toLowerCase().trim();
    const baseData = applyFilters(itemData, activeStatus, show1688Only);

    const filtered = baseData.filter(item =>
      item.order_number?.toLowerCase().includes(searchLower) ||
      item['1688_order_number']?.toLowerCase().includes(searchLower) ||
      item.product_name?.toLowerCase().includes(searchLower)
    );

    setFilteredData(filtered);
    setCurrentPage(1);
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

  // 날짜 포맷 함수
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR');
  };

  // 상태 업데이트 공통 함수
  const updateRefundStatus = async (newStatus: string) => {
    if (selectedItems.size === 0) {
      alert('항목을 선택해주세요.');
      return;
    }

    const selectedIds = Array.from(selectedItems);

    try {
      const response = await fetch('/api/update-refund-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: selectedIds,
          status: newStatus
        })
      });

      const result = await response.json();

      if (result.success) {
        // 데이터 새로고침 (현재 탭 유지)
        const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
        if (selectedUser?.user_id) {
          await fetchRefundOrders(selectedUser.user_id, true);
        }

        // 선택 초기화
        setSelectedItems(new Set());
        setSelectAll(false);
      } else {
        alert(`상태 변경 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('상태 업데이트 오류:', error);
      alert('상태 업데이트 중 오류가 발생했습니다.');
    }
  };

  // 가격 수정 핸들러
  const handleProductPriceChange = (itemId: string, value: string) => {
    const numValue = value === '' ? null : Number(value);
    setEditingProductPrice(prev => ({ ...prev, [itemId]: numValue }));
  };

  // 반품사유 수정 핸들러
  const handleRefundDescriptionChange = (itemId: string, value: string) => {
    setEditingRefundDescription(prev => ({ ...prev, [itemId]: value }));
  };

  // 배송비 수정 핸들러
  const handleDeliveryFeeChange = (itemId: string, value: string) => {
    const numValue = value === '' ? null : Number(value);
    setEditingDeliveryFee(prev => ({ ...prev, [itemId]: numValue }));
  };

  // 서비스비 수정 핸들러
  const handleServiceFeeChange = (itemId: string, value: string) => {
    const numValue = value === '' ? null : Number(value);
    setEditingServiceFee(prev => ({ ...prev, [itemId]: numValue }));
  };

  // 확정일 수정 핸들러 (YYMMDD 형식 입력 -> YYYY-MM-DD 변환)
  const handleConfirmDateChange = (itemId: string, value: string) => {
    // 숫자만 추출
    const numericValue = value.replace(/\D/g, '');
    setEditingConfirmDate(prev => ({ ...prev, [itemId]: numericValue }));
  };

  // YYMMDD를 YYYY-MM-DD 형식으로 변환
  const convertToDateFormat = (yymmdd: string): string | null => {
    if (!yymmdd || yymmdd.length !== 6) return null;
    const yy = yymmdd.substring(0, 2);
    const mm = yymmdd.substring(2, 4);
    const dd = yymmdd.substring(4, 6);
    const year = parseInt(yy) > 50 ? `19${yy}` : `20${yy}`;
    return `${year}-${mm}-${dd}`;
  };

  // 날짜 표시용 (YYYY-MM-DD -> YY.MM.DD) - 일반 표시
  const formatConfirmDateDisplay = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = dateStr.split('T')[0];
    if (date.length === 10) {
      const parts = date.split('-');
      return `${parts[0].substring(2)}.${parts[1]}.${parts[2]}`;
    }
    return '';
  };

  // 날짜 편집용 (YYYY-MM-DD -> YYMMDD) - 수정 시
  const formatConfirmDateEdit = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = dateStr.split('T')[0];
    if (date.length === 10) {
      const parts = date.split('-');
      return `${parts[0].substring(2)}${parts[1]}${parts[2]}`;
    }
    return '';
  };

  // 데이터 저장 (상태 업데이트 시 함께 저장)
  const saveRefundAmounts = async () => {
    const priceUpdates = Object.entries(editingProductPrice);
    const descriptionUpdates = Object.entries(editingRefundDescription);
    const deliveryFeeUpdates = Object.entries(editingDeliveryFee);
    const serviceFeeUpdates = Object.entries(editingServiceFee);
    const confirmDateUpdates = Object.entries(editingConfirmDate);

    if (priceUpdates.length === 0 && descriptionUpdates.length === 0 && deliveryFeeUpdates.length === 0 && serviceFeeUpdates.length === 0 && confirmDateUpdates.length === 0) return true;

    try {
      // 가격 저장 (product_price)
      for (const [id, price] of priceUpdates) {
        const response = await fetch('/api/update-refund-amount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, product_price: price })
        });

        const result = await response.json();
        if (!result.success) {
          console.error(`가격 저장 실패 (${id}):`, result.error);
          return false;
        }
      }

      // 반품사유 저장
      for (const [id, description] of descriptionUpdates) {
        const response = await fetch('/api/update-refund-amount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, refund_description: description })
        });

        const result = await response.json();
        if (!result.success) {
          console.error(`반품사유 저장 실패 (${id}):`, result.error);
          return false;
        }
      }

      // 배송비 저장
      for (const [id, deliveryFee] of deliveryFeeUpdates) {
        const response = await fetch('/api/update-refund-amount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, delivery_fee: deliveryFee })
        });

        const result = await response.json();
        if (!result.success) {
          console.error(`배송비 저장 실패 (${id}):`, result.error);
          return false;
        }
      }

      // 서비스비 저장
      for (const [id, serviceFee] of serviceFeeUpdates) {
        const response = await fetch('/api/update-refund-amount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, service_fee: serviceFee })
        });

        const result = await response.json();
        if (!result.success) {
          console.error(`서비스비 저장 실패 (${id}):`, result.error);
          return false;
        }
      }

      // 확정일 저장 (YYMMDD -> YYYY-MM-DD 변환)
      for (const [id, confirmDateInput] of confirmDateUpdates) {
        const convertedDate = confirmDateInput ? convertToDateFormat(confirmDateInput) : null;
        const response = await fetch('/api/update-refund-amount', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, confirm_date: convertedDate })
        });

        const result = await response.json();
        if (!result.success) {
          console.error(`확정일 저장 실패 (${id}):`, result.error);
          return false;
        }
      }

      setEditingProductPrice({});
      setEditingRefundDescription({});
      setEditingDeliveryFee({});
      setEditingServiceFee({});
      setEditingConfirmDate({});
      return true;
    } catch (error) {
      console.error('데이터 저장 오류:', error);
      return false;
    }
  };

  // 선택된 항목들의 완료 조건 검증 (가격, 배송비, 서비스, 날짜)
  const validateForComplete = (): boolean => {
    const selectedIds = Array.from(selectedItems);
    for (const id of selectedIds) {
      const item = itemData.find(i => i.id === id);

      // 가격 검증
      const editedPrice = editingProductPrice[id];
      const currentPrice = editedPrice !== undefined ? editedPrice : item?.product_price;
      if (currentPrice === null || currentPrice === undefined || currentPrice <= 0) {
        alert('가격을 입력해주세요.');
        return false;
      }

      // 배송비 검증
      const editedDeliveryFee = editingDeliveryFee[id];
      const currentDeliveryFee = editedDeliveryFee !== undefined ? editedDeliveryFee : item?.delivery_fee;
      if (currentDeliveryFee === null || currentDeliveryFee === undefined) {
        alert('배송비를 입력해주세요.');
        return false;
      }

      // 서비스비 검증 (0은 허용, null/undefined만 불허)
      const editedServiceFee = editingServiceFee[id];
      const currentServiceFee = editedServiceFee !== undefined ? editedServiceFee : item?.service_fee;
      if (currentServiceFee === null || currentServiceFee === undefined) {
        alert('서비스를 입력해주세요.');
        return false;
      }

      // 날짜 검증
      const editedDate = editingConfirmDate[id];
      const hasDate = (editedDate && editedDate.length === 6) || item?.confirm_date;
      if (!hasDate) {
        alert('날짜를 입력해주세요.');
        return false;
      }
    }
    return true;
  };

  // [진행] 버튼 클릭 (접수 -> 진행)
  const handleProgressClick = async () => {
    await saveRefundAmounts();
    await updateRefundStatus('진행');
  };

  // [완료] 버튼 클릭 (진행 -> 완료)
  const handleCompleteClick = async () => {
    if (!validateForComplete()) return;

    await saveRefundAmounts();
    await updateRefundStatus('완료');
  };

  // [취소] 버튼 클릭 (어떤 상태든 -> 취소)
  const handleCancelClick = async () => {
    await updateRefundStatus('취소');
  };

  // [접수] 버튼 클릭 (취소 -> 접수)
  const handleRestoreToProgressClick = async () => {
    await updateRefundStatus('접수');
  };

  // [진행] 버튼 클릭 (취소 -> 진행)
  const handleRestoreToInProgressClick = async () => {
    await updateRefundStatus('진행');
  };

  // [1688 조회] 버튼 클릭 - '접수' 상태의 모든 항목 조회
  const handle1688SearchClick = async () => {
    const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
    if (!selectedUser?.user_id) {
      alert('사용자를 선택해주세요.');
      return;
    }

    // '접수' 상태의 모든 항목 필터링
    const pendingOrders = itemData.filter(item => item.refund_status === '접수');

    if (pendingOrders.length === 0) {
      alert('조회할 접수 상태의 항목이 없습니다.');
      return;
    }

    const orderNumbers = pendingOrders
      .map(item => item.order_number)
      .filter((num): num is string => num !== null && num !== '');

    if (orderNumbers.length === 0) {
      alert('조회할 주문번호가 없습니다.');
      return;
    }

    try {
      setLoading(true);

      // id와 order_number 매핑 전달
      const orderData = pendingOrders.map(item => ({
        id: item.id,
        order_number: item.order_number
      }));

      const response = await fetch('/api/search-1688-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderData, user_id: selectedUser.user_id })
      });

      const result = await response.json();

      if (result.success) {
        const { total, found, notFound } = result.data;

        let message = `총 ${total}건 조회\n`;
        message += `- 찾음: ${found}건\n`;
        if (notFound.length > 0) {
          message += `- 찾지 못함: ${notFound.length}건`;
          if (notFound.length <= 5) {
            message += `\n  (${notFound.join(', ')})`;
          }
        }

        alert(message);

        // 데이터 새로고침 (현재 탭 유지)
        await fetchRefundOrders(selectedUser.user_id, true);

        // 선택 초기화
        setSelectedItems(new Set());
        setSelectAll(false);
      } else {
        alert(`조회 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('1688 조회 오류:', error);
      alert('1688 조회 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // [삭제] 버튼 클릭
  const handleDeleteClick = async () => {
    if (selectedItems.size === 0) {
      alert('삭제할 항목을 선택해주세요.');
      return;
    }

    if (!confirm(`선택한 ${selectedItems.size}개 항목을 삭제하시겠습니까?`)) {
      return;
    }

    const selectedIds = Array.from(selectedItems);

    try {
      const response = await fetch('/api/delete-refund-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds })
      });

      const result = await response.json();

      if (result.success) {
        // 데이터 새로고침 (현재 탭 유지)
        const selectedUser = coupangUsers.find(user => user.coupang_name === selectedCoupangUser);
        if (selectedUser?.user_id) {
          await fetchRefundOrders(selectedUser.user_id, true);
        }

        // 선택 초기화
        setSelectedItems(new Set());
        setSelectAll(false);
      } else {
        alert(`삭제 실패: ${result.error}`);
      }
    } catch (error) {
      console.error('삭제 오류:', error);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = async () => {
    if (filteredData.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    try {
      const XLSX = await import('xlsx');

      const excelData = filteredData.map((item) => ({
        '주문번호': item.order_number || '',
        '상품명': item.product_name || '',
        '옵션명': item.option_name_cn || '',
        '수량': item.qty ?? '',
        '반품금액': item.refund_amount ?? '',
        '반품요청': item.refund_type || '',
        '반품사유': item.refund_description || '',
        '상태': item.refund_status || '',
        '생성일': formatDate(item.created_at),
        '반품완료일': formatDate(item.confirm_date),
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '주문취소');

      const fileName = `주문취소_${selectedCoupangUser}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, fileName);

    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="order-history-layout">
      <TopsideMenu />
      <div className="order-history-main-content">
        <LeftsideMenu />
        <main className="order-history-content">
          <div className="order-history-container">
            {/* 타이틀 행 */}
            <div className="order-history-title-row">
              <h1 className="order-history-title">주문 취소</h1>
              <div className="order-history-title-controls">
                <select
                  className="order-history-user-dropdown"
                  value={selectedCoupangUser}
                  onChange={(e) => setSelectedCoupangUser(e.target.value)}
                >
                  <option value="">{t('importProduct.selectUser')}</option>
                  {coupangUsers.map((user) => {
                    const displayName = user.user_code
                      ? `${user.user_code} ${user.coupang_name}`
                      : user.coupang_name;

                    return (
                      <option key={user.coupang_name} value={user.coupang_name}>
                        {displayName}
                      </option>
                    );
                  })}
                </select>
                <button
                  className="order-history-upload-btn"
                  onClick={handleLoad}
                  disabled={!selectedCoupangUser || loading}
                >
                  {loading ? (
                    <span className="order-history-button-loading">
                      <span className="order-history-spinner"></span>
                      불러오기
                    </span>
                  ) : (
                    '불러오기'
                  )}
                </button>
                <button
                  className="order-history-update-btn"
                  onClick={handleUpdate}
                  disabled={!selectedCoupangUser || loading}
                >
                  업데이트
                </button>
                <button
                  className="order-history-download-btn"
                  onClick={handleExcelDownload}
                  disabled={filteredData.length === 0}
                >
                  엑셀 다운로드
                </button>
                <button
                  className="order-history-delete-btn"
                  disabled={selectedItems.size === 0}
                  onClick={handleDeleteClick}
                >
                  삭제
                </button>
              </div>
            </div>

            {/* 잔액 보드 */}
            <div className="order-history-balance-section">
              <div className="order-history-balance-board">
                <div className="order-history-balance-item">
                  <span className="order-history-balance-label">잔액:</span>
                  <span className="order-history-balance-value">
                    {balance !== null ? balance.toLocaleString() : '-'}
                  </span>
                </div>
                <div className="order-history-balance-divider"></div>
                <div className="order-history-balance-item">
                  <span className="order-history-balance-label">라이브 잔액:</span>
                  <span className="order-history-balance-value">
                    {liveBalance !== null ? liveBalance.toLocaleString() : '-'}
                  </span>
                </div>
              </div>
            </div>

            {/* 상태 카드들 */}
            <div className="order-history-status-cards">
              {cardData.map((statusCard, index) => {
                const count = getStatusCount(statusCard.key);
                const isActive = activeStatus === statusCard.key;

                return (
                  <OrderHistoryStatusCard
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
            <div className="order-history-search-section">
              <div className="order-history-search-board">
                <div className="order-history-search-form-container">
                  <input
                    type="text"
                    className="order-history-search-input"
                    placeholder="주문번호, 상품명, 반품사유를 입력하세요"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="order-history-search-button" onClick={handleSearchClick}>
                    {t('importProduct.search')}
                  </button>
                </div>
              </div>
            </div>

            {/* 테이블 상단 액션 버튼 */}
            <div className="order-history-table-actions">
              <select
                className="order-history-items-per-page"
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={30}>30개씩 보기</option>
                <option value={50}>50개씩 보기</option>
                <option value={100}>100개씩 보기</option>
              </select>
              <button
                className="order-history-search-1688-btn"
                onClick={handle1688SearchClick}
                disabled={!selectedCoupangUser || loading}
              >
                1688 조회
              </button>
              <label className="order-history-1688-only-checkbox">
                <input
                  type="checkbox"
                  checked={show1688Only}
                  onChange={(e) => {
                    const newShow1688Only = e.target.checked;
                    setShow1688Only(newShow1688Only);
                    const filtered = applyFilters(itemData, activeStatus, newShow1688Only);
                    setFilteredData(filtered);
                    setCurrentPage(1);
                  }}
                />
                <span>1688 주문번호만 표시</span>
              </label>
              <div style={{ flex: 1 }}></div>
              {activeStatus === 'all' ? (
                <>
                  <button className="order-history-action-btn" disabled>진행</button>
                  <button className="order-history-cancel-btn" disabled>취소</button>
                </>
              ) : activeStatus === '접수' ? (
                <>
                  <button
                    className="order-history-action-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleProgressClick}
                  >
                    진행
                  </button>
                  <button
                    className="order-history-cancel-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleCancelClick}
                  >
                    취소
                  </button>
                </>
              ) : activeStatus === '진행' ? (
                <>
                  <button
                    className="order-history-complete-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleCompleteClick}
                  >
                    완료
                  </button>
                  <button
                    className="order-history-cancel-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleCancelClick}
                  >
                    취소
                  </button>
                </>
              ) : activeStatus === '완료' ? (
                <button
                  className="order-history-cancel-btn"
                  disabled={selectedItems.size === 0}
                  onClick={handleCancelClick}
                >
                  취소
                </button>
              ) : activeStatus === '취소' ? (
                <>
                  <button
                    className="order-history-action-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleRestoreToProgressClick}
                  >
                    접수
                  </button>
                  <button
                    className="order-history-complete-btn"
                    disabled={selectedItems.size === 0}
                    onClick={handleRestoreToInProgressClick}
                  >
                    진행
                  </button>
                </>
              ) : null}
            </div>

            {/* 테이블 */}
            <div className="order-history-table-board">
              {loading ? (
                <div className="order-history-empty-data">{t('importProduct.table.loading')}</div>
              ) : (
                <table className="order-history-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={handleSelectAll}
                          className="order-history-table-checkbox"
                        />
                      </th>
                      <th>주문번호</th>
                      <th>상품명</th>
                      <th>수량</th>
                      <th>가격</th>
                      <th>배송비</th>
                      <th>서비스</th>
                      <th>반품사유</th>
                      <th>상태</th>
                      <th>날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="order-history-empty-data">
                          {t('importProduct.table.noData')}
                        </td>
                      </tr>
                    ) : (
                      paginatedData.map((item) => (
                        <tr key={item.id} className={selectedItems.has(item.id) ? 'selected' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => handleSelectItem(item.id)}
                              className="order-history-table-checkbox"
                            />
                          </td>
                          <td>
                            <div className="order-history-order-number-text">
                              {item.site_url ? (
                                <a
                                  href={item.site_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="order-history-link"
                                >
                                  {item.order_number || '-'}
                                </a>
                              ) : (
                                <span>{item.order_number || '-'}</span>
                              )}
                              {item['1688_order_number'] && (
                                <>
                                  <br />
                                  <span className="order-history-1688-order-number">{item['1688_order_number']}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="order-history-product-name">
                              {item.img_url ? (
                                <span
                                  className="order-history-link"
                                  onClick={() => {
                                    setSelectedImageUrl(item.img_url);
                                    setShowImageModal(true);
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {item.product_name || '-'}
                                </span>
                              ) : (
                                <span>{item.product_name || '-'}</span>
                              )}
                              {item.option_name_cn && (
                                <>
                                  <br />
                                  <span className="order-history-option-name">{item.option_name_cn}</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td>
                            {item.qty ?? '-'}
                          </td>
                          <td
                            className="order-history-refund-amount-cell"
                            onClick={(e) => {
                              const input = e.currentTarget.querySelector('input');
                              input?.focus();
                            }}
                          >
                            <input
                              type="number"
                              className="order-history-refund-amount-input"
                              value={editingProductPrice[item.id] !== undefined ? editingProductPrice[item.id] ?? '' : item.product_price ?? ''}
                              onChange={(e) => handleProductPriceChange(item.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const currentValue = editingProductPrice[item.id] !== undefined ? editingProductPrice[item.id] : item.product_price;
                                  if (currentValue !== null && currentValue !== undefined) {
                                    const serviceFee = Math.round(currentValue * 0.06 * 100) / 100;
                                    setEditingServiceFee(prev => ({ ...prev, [item.id]: serviceFee }));
                                  }
                                  // 배송비 입력 필드로 포커스 이동
                                  const currentCell = e.currentTarget.closest('td');
                                  const nextCell = currentCell?.nextElementSibling;
                                  const nextInput = nextCell?.querySelector('input') as HTMLInputElement;
                                  nextInput?.focus();
                                  nextInput?.select();
                                }
                              }}
                              placeholder="금액"
                            />
                          </td>
                          <td
                            className="order-history-refund-amount-cell"
                            onClick={(e) => {
                              const input = e.currentTarget.querySelector('input');
                              input?.focus();
                            }}
                          >
                            <input
                              type="number"
                              className="order-history-refund-amount-input"
                              value={editingDeliveryFee[item.id] !== undefined ? editingDeliveryFee[item.id] ?? '' : item.delivery_fee ?? ''}
                              onChange={(e) => handleDeliveryFeeChange(item.id, e.target.value)}
                              placeholder="배송비"
                            />
                          </td>
                          <td
                            className="order-history-refund-amount-cell"
                            onClick={(e) => {
                              const input = e.currentTarget.querySelector('input');
                              input?.focus();
                            }}
                          >
                            <input
                              type="number"
                              className="order-history-refund-amount-input"
                              value={editingServiceFee[item.id] !== undefined ? editingServiceFee[item.id] ?? '' : item.service_fee ?? ''}
                              onChange={(e) => handleServiceFeeChange(item.id, e.target.value)}
                              placeholder="서비스"
                            />
                          </td>
                          <td
                            className="order-history-refund-description-cell"
                            onClick={(e) => {
                              const textarea = e.currentTarget.querySelector('textarea');
                              textarea?.focus();
                            }}
                          >
                            <textarea
                              className="order-history-refund-description-input"
                              value={editingRefundDescription[item.id] !== undefined ? editingRefundDescription[item.id] : item.refund_description || ''}
                              onChange={(e) => handleRefundDescriptionChange(item.id, e.target.value)}
                              placeholder="반품사유"
                              rows={3}
                            />
                          </td>
                          <td>
                            <span className={`order-history-status-badge ${item.refund_status?.toLowerCase().replace(/\s/g, '-') || ''}`}>
                              {item.refund_status || '-'}
                            </span>
                          </td>
                          <td
                            className="order-history-refund-amount-cell"
                            onClick={(e) => {
                              const input = e.currentTarget.querySelector('input');
                              input?.focus();
                            }}
                          >
                            <input
                              type="text"
                              className="order-history-refund-amount-input"
                              value={
                                focusedDateCell === item.id
                                  ? (editingConfirmDate[item.id] !== undefined ? editingConfirmDate[item.id] : formatConfirmDateEdit(item.confirm_date))
                                  : (editingConfirmDate[item.id] !== undefined
                                      ? (editingConfirmDate[item.id].length === 6 ? `${editingConfirmDate[item.id].substring(0,2)}.${editingConfirmDate[item.id].substring(2,4)}.${editingConfirmDate[item.id].substring(4,6)}` : editingConfirmDate[item.id])
                                      : formatConfirmDateDisplay(item.confirm_date))
                              }
                              onChange={(e) => handleConfirmDateChange(item.id, e.target.value)}
                              onFocus={() => {
                                setFocusedDateCell(item.id);
                                if (editingConfirmDate[item.id] === undefined && item.confirm_date) {
                                  setEditingConfirmDate(prev => ({ ...prev, [item.id]: formatConfirmDateEdit(item.confirm_date) }));
                                }
                              }}
                              onBlur={() => setFocusedDateCell(null)}
                              placeholder="YYMMDD"
                              maxLength={6}
                            />
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
              <div className="order-history-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="order-history-pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>

                <div className="order-history-page-numbers">
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
                        className={`order-history-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="order-history-pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="order-history-page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 이미지 모달 */}
      {showImageModal && selectedImageUrl && (
        <div className="order-history-modal-overlay" onClick={() => setShowImageModal(false)}>
          <div className="order-history-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="order-history-modal-close" onClick={() => setShowImageModal(false)}>
              ×
            </button>
            <img
              src={`/api/image-proxy?url=${encodeURIComponent(selectedImageUrl)}`}
              alt="Product"
              className="order-history-modal-image"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent && !parent.querySelector('.error-message')) {
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'error-message';
                  errorDiv.style.padding = '20px';
                  errorDiv.style.color = '#666';
                  errorDiv.textContent = '이미지를 불러올 수 없습니다.';
                  parent.appendChild(errorDiv);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderHistory;
