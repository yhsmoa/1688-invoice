'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './OrderCheck.css';
import { matchDeliveryInfo, formatInfoColumn, type DeliveryInfo } from './utils/deliveryMatcher';
import OrderCheckStatusCard from './OrderCheckStatusCard';

// 데이터 타입 정의 - 상품 입고 페이지와 동일
export interface OrderCheckData {
  id: string;
  row_number?: string;
  image_url?: string;
  site_url?: string;
  order_number_prefix?: string;
  order_number: string;
  product_name: string | null;
  product_name_sub?: string | null;
  barcode?: string | null;
  china_option1?: string | null;
  china_option2?: string | null;
  order_qty: number | null;
  cost?: string | null;
  cost_sub?: string | null;
  progress_status?: number | null;
  import_qty?: number | null;
  cancel_qty?: number | null;
  export_qty?: number | null;
  note?: string | null;
  option_id?: string | null;
  product_size?: string | null;
  delivery_status?: string | null;
  delivery_shop?: string;
  delivery_order_id?: string;
  delivery_code?: string;
  order_payment_time?: string | null;
}

const OrderCheck: React.FC = () => {
  const { t } = useTranslation();

  // 카드 데이터 정의 - delivery_status 기반
  const DELIVERY_STATUS_LABELS = {
    'all': '전체',
    '等待买家确认收货': '等待买家确认收货\n수령대기',
    '等待卖家发货': '等待卖家发货\n판매자 배송 전',
    '交易关闭': '交易关闭\n거래 종료',
    '退款中': '退款中\n환불 진행 중',
    '交易成功': '交易成功\n거래 성공',
    'unmatched': '미매칭'
  };

  const cardData = [
    { key: 'all', label: DELIVERY_STATUS_LABELS['all'] },
    { key: '等待买家确认收货', label: DELIVERY_STATUS_LABELS['等待买家确认收货'] },
    { key: '等待卖家发货', label: DELIVERY_STATUS_LABELS['等待卖家发货'] },
    { key: '交易关闭', label: DELIVERY_STATUS_LABELS['交易关闭'] },
    { key: '退款中', label: DELIVERY_STATUS_LABELS['退款中'] },
    { key: '交易成功', label: DELIVERY_STATUS_LABELS['交易成功'] },
    { key: 'unmatched', label: DELIVERY_STATUS_LABELS['unmatched'] }
  ];

  // State 관리
  const [itemData, setItemData] = useState<OrderCheckData[]>([]);
  const [filteredData, setFilteredData] = useState<OrderCheckData[]>([]);
  const [loading, setLoading] = useState(false);
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string}[]>([]);
  const [selectedCoupangUser, setSelectedCoupangUser] = useState<string>('');
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchType, setSearchType] = useState('일반검색');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [deliveryInfoData, setDeliveryInfoData] = useState<DeliveryInfo[]>([]);
  const [activeStatus, setActiveStatus] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const excelFileInputRef = useRef<HTMLInputElement>(null);
  const itemsPerPage = 20;

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
  const filterByStatus = (statusKey: string): OrderCheckData[] => {
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

  // 배송 정보 가져오기
  const fetchDeliveryInfo = async (): Promise<DeliveryInfo[]> => {
    try {
      console.log('배송 정보 가져오기 시작...');
      const response = await fetch('/api/get-all-delivery-info-check');
      const result = await response.json();

      if (result.success && result.data) {
        setDeliveryInfoData(result.data);
        console.log(`배송 정보 ${result.data.length}개 로드 완료`);
        return result.data; // 데이터 직접 반환
      } else {
        console.warn('배송 정보를 가져오지 못했습니다:', result);
        return [];
      }
    } catch (error) {
      console.error('배송 정보 가져오기 오류:', error);
      return [];
    }
  };

  useEffect(() => {
    fetchCoupangUsers();
    fetchDeliveryInfo();
  }, []);

  // 드롭다운 선택 시 구글 시트 데이터 자동 로드
  useEffect(() => {
    if (selectedCoupangUser) {
      handleLoadGoogleSheet();
    }
  }, [selectedCoupangUser]);

  // 구글 시트 데이터 로드
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

      // 구글 시트 데이터 로드 전에 최신 배송 정보 가져오기
      console.log('📦 구글 시트 로드 전 배송 정보 새로고침 시작...');
      const latestDeliveryInfo = await fetchDeliveryInfo();
      console.log('✅ 배송 정보 새로고침 완료 - 개수:', latestDeliveryInfo.length);

      // 구글 시트 데이터 로드 API 호출
      const response = await fetch('/api/load-google-sheet-order-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          googlesheet_id: selectedUser.googlesheet_id,
          coupang_name: selectedCoupangUser
        }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        // 최신 배송 정보로 매칭 (방금 가져온 latestDeliveryInfo 사용)
        console.log('🔄 매칭 시작 - 배송 정보 개수:', latestDeliveryInfo.length);
        const matchedData = matchDeliveryInfo(result.data, latestDeliveryInfo);

        setItemData(matchedData);
        setFilteredData(matchedData);
        setLoading(false);
        alert(`데이터를 불러왔습니다. (${matchedData.length}개 항목)`);
      } else {
        console.error('구글 시트 API 오류:', result.error);
        alert(result.error || '구글 시트 데이터를 불러오는데 실패했습니다.');
        setLoading(false);
      }
    } catch (error) {
      console.error('구글 시트 데이터 불러오기 오류:', error);
      alert(`구글 시트 데이터를 불러오는데 실패했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setLoading(false);
    }
  };

  // 엑셀 업로드 버튼 클릭
  const handleExcelUpload = () => {
    excelFileInputRef.current?.click();
  };

  // 엑셀 파일 선택 시 처리
  const handleExcelFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
      return;
    }

    setIsUploadingExcel(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      console.log('엑셀 파일 업로드 시작:', file.name);

      const response = await fetch('/api/upload-order-check-excel', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        alert(`엑셀 파일이 성공적으로 업로드되었습니다.\n저장된 데이터: ${result.count || 0}개`);
        console.log('업로드 성공:', result);

        // 엑셀 업로드 성공 후 배송 정보 다시 가져오기
        await fetchDeliveryInfo();
        console.log('✅ 배송 정보 새로고침 완료');
      } else {
        console.error('업로드 실패:', result);
        alert(result.error || '업로드 중 오류가 발생했습니다.');
      }
    } catch (error) {
      console.error('업로드 중 예외 발생:', error);
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setIsUploadingExcel(false);
      if (excelFileInputRef.current) {
        excelFileInputRef.current.value = '';
      }
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

  // 검색 기능
  const handleSearchClick = () => {
    if (!searchTerm.trim()) {
      setFilteredData(itemData);
      setCurrentPage(1);
      return;
    }

    const searchLower = searchTerm.toLowerCase().trim();

    let filtered: OrderCheckData[] = [];

    if (searchType === '배송번호/offerID') {
      // 배송번호/offerID 검색 - delivery_code와 offer_id에서 검색
      filtered = itemData.filter(item => {
        return (
          item.delivery_code?.toLowerCase().includes(searchLower) ||
          deliveryInfoData.some(info =>
            info.offer_id?.toLowerCase().includes(searchLower) &&
            info.delivery_code === item.delivery_code
          )
        );
      });
    } else {
      // 일반검색
      filtered = itemData.filter(item => {
        return (
          item.product_name?.toLowerCase().includes(searchLower) ||
          item.order_number?.toLowerCase().includes(searchLower) ||
          item.barcode?.toLowerCase().includes(searchLower) ||
          item.china_option1?.toLowerCase().includes(searchLower) ||
          item.china_option2?.toLowerCase().includes(searchLower)
        );
      });
    }

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
  const handleCostClick = (e: React.MouseEvent, item: OrderCheckData) => {
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

  // 엑셀 다운로드 핸들러
  const handleExcelDownload = async () => {
    if (filteredData.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    try {
      const XLSX = await import('xlsx');

      // 구글 시트 양식대로 데이터 변환
      const excelData = filteredData.map((item) => {
        return {
          '': item.order_number_prefix || '',  // A열
          '글번호': item.order_number || '',    // B열
          '상품명': item.product_name || '',    // C열
          '': item.product_name_sub || '',      // D열
          '개수': item.order_qty || 0,          // E열
          '바코드': item.barcode || '',         // F열
          '주문옵션1': item.china_option1 || '', // G열
          '주문옵션2': item.china_option2 || '', // H열
          '비용': item.cost || '',              // I열
          '': item.cost_sub || '',              // J열
          '이미지': item.image_url || '',       // K열
          'URL': item.site_url || '',          // L열
          '진행': item.progress_status || '',   // M열
          '입고': item.import_qty || '',        // N열
          '취소': item.cancel_qty || '',        // O열
          '출고': item.export_qty || '',        // P열
          '': '',                               // Q열 (비어있음)
          '비고': item.note || '',              // R열
        };
      });

      // 워크북 생성
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '진행');

      // 파일 다운로드
      const fileName = `주문검사_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      console.log('엑셀 다운로드 완료:', fileName);
    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="order-check-layout" onMouseMove={handleMouseMove}>
      <TopsideMenu />
      <div className="order-check-main-content">
        <LeftsideMenu />
        <main className="order-check-content">
          <div className="order-check-container">
            <h1 className="order-check-title">주문 검사</h1>

            {/* 시트 불러오기 버튼 - 왼쪽/오른쪽 분리 */}
            <div className="order-check-upload-section">
              {/* 왼쪽: 드롭다운, 업데이트, 엑셀 불러오기 */}
              <div className="order-check-upload-left">
                <select
                  className="order-check-user-dropdown"
                  value={selectedCoupangUser}
                  onChange={(e) => setSelectedCoupangUser(e.target.value)}
                >
                  <option value="">{t('importProduct.selectUser')}</option>
                  {coupangUsers.map((user) => {
                    const cacheKey = `sheet_data_${user.coupang_name}`;
                    const hasCachedData = localStorage.getItem(cacheKey) !== null;

                    return (
                      <option key={user.coupang_name} value={user.coupang_name}>
                        {user.coupang_name} {hasCachedData ? '●' : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  className="order-check-upload-btn"
                  onClick={handleLoadGoogleSheet}
                  disabled={loading}
                >
                  {loading ? (
                    <span className="order-check-button-loading">
                      <span className="order-check-spinner"></span>
                      {t('importProduct.refresh')}
                    </span>
                  ) : (
                    t('importProduct.refresh')
                  )}
                </button>
                <button
                  className="order-check-upload-btn"
                  onClick={handleExcelUpload}
                  disabled={isUploadingExcel}
                >
                  {isUploadingExcel ? t('importProduct.uploading') : t('importProduct.uploadExcel')}
                </button>

                <input
                  type="file"
                  ref={excelFileInputRef}
                  onChange={handleExcelFileChange}
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                />
              </div>

              {/* 오른쪽: 엑셀 다운로드 */}
              <div className="order-check-upload-right">
                <button
                  className="order-check-download-btn"
                  onClick={handleExcelDownload}
                  disabled={filteredData.length === 0}
                >
                  엑셀 다운로드
                </button>
              </div>
            </div>

            {/* 상태 카드들 */}
            <div className="order-check-status-cards">
              {cardData.map((statusCard, index) => {
                const count = getStatusCount(statusCard.key);
                const isActive = activeStatus === statusCard.key;

                return (
                  <OrderCheckStatusCard
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
            <div className="order-check-search-section">
              <div className="order-check-search-board">
                <div className="order-check-search-form-container">
                  <select
                    className="order-check-search-dropdown"
                    value={searchType}
                    onChange={(e) => setSearchType(e.target.value)}
                  >
                    <option value="일반검색">일반검색</option>
                    <option value="배송번호/offerID">배송번호/offerID</option>
                  </select>
                  <input
                    type="text"
                    className="order-check-search-input"
                    placeholder={searchType === '배송번호/offerID' ? '배송번호 또는 offerID를 입력하세요' : '상품명, 주문번호, 바코드를 입력하세요'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyPress={handleSearchKeyPress}
                  />
                  <button className="order-check-search-button" onClick={handleSearchClick}>
                    {t('importProduct.search')}
                  </button>
                </div>
              </div>
            </div>

            {/* 테이블 */}
            <div className="order-check-table-board">
              {loading ? (
                <div className="order-check-empty-data">{t('importProduct.table.loading')}</div>
              ) : (
                <table className="order-check-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={handleSelectAll}
                          className="order-check-table-checkbox"
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
                    {paginatedData.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="order-check-empty-data">
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
                              className="order-check-table-checkbox"
                            />
                          </td>
                          <td>
                            {item.image_url ? (
                              <div className="order-check-image-preview-container">
                                <img
                                  src={`/api/image-proxy?url=${encodeURIComponent(item.image_url)}`}
                                  alt="상품 이미지"
                                  className="order-check-product-thumbnail"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = '/placeholder.svg';
                                  }}
                                />
                                <div
                                  className="order-check-image-preview"
                                  style={{
                                    top: `${mousePosition.y - 300}px`,
                                    left: `${mousePosition.x + 30}px`
                                  }}
                                >
                                  <img
                                    src={`/api/image-proxy?url=${encodeURIComponent(item.image_url)}`}
                                    alt="상품 이미지 미리보기"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = '/placeholder.svg';
                                    }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="order-check-no-image">{t('importProduct.table.noImage')}</div>
                            )}
                          </td>
                          <td>
                            <div className="order-check-order-number-text">
                              {item.order_number_prefix || ''}
                              {item.order_number_prefix && item.order_number && <br />}
                              {item.order_number || ''}
                            </div>
                          </td>
                          <td>
                            <div className="order-check-product-name">
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
                            <div className="order-check-china-options">
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
                              className="order-check-cost-display order-check-clickable-cost"
                              onClick={(e) => handleCostClick(e, item)}
                              title={item.site_url ? '클릭하여 사이트로 이동' : 'URL을 입력하여 사이트로 이동'}
                            >
                              {item.cost || '-'}
                              {item.cost_sub && (
                                <>
                                  <br />
                                  {item.cost_sub}
                                </>
                              )}
                            </div>
                          </td>
                          <td>
                            {item.progress_status ? (
                              <span className="order-check-status-badge progress">
                                {item.progress_status}
                              </span>
                            ) : ''}
                          </td>
                          <td>
                            {item.import_qty ? (
                              <span className="order-check-status-badge import">
                                {item.import_qty}
                              </span>
                            ) : ''}
                          </td>
                          <td>
                            {item.cancel_qty ? (
                              <span className="order-check-status-badge cancel">
                                {item.cancel_qty}
                              </span>
                            ) : ''}
                          </td>
                          <td>
                            {item.export_qty ? (
                              <span className="order-check-status-badge export">
                                {item.export_qty}
                              </span>
                            ) : ''}
                          </td>
                          <td>
                            <div className="order-check-note-display">{item.note || ''}</div>
                          </td>
                          <td>
                            <div style={{ lineHeight: '1.5', fontSize: '12px', color: '#333', whiteSpace: 'pre-line' }}>
                              {formatInfoColumn(item)}
                            </div>
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
              <div className="order-check-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="order-check-pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>

                <div className="order-check-page-numbers">
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
                        className={`order-check-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="order-check-pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="order-check-page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {filteredData.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default OrderCheck;
