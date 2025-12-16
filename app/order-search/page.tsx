'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './order-search.css';

interface OrderSearchData {
  id: string;
  shop?: string;
  offer_id?: string;
  delivery_status?: string;
  order_id?: string;
  order_info?: string;
}

const OrderSearch: React.FC = () => {
  const { t } = useTranslation();
  const [orderData, setOrderData] = useState<OrderSearchData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredData, setFilteredData] = useState<OrderSearchData[]>([]);
  const [viewMode, setViewMode] = useState<string>('orderNumber');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [paginatedData, setPaginatedData] = useState<OrderSearchData[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // 페이지네이션 처리 함수
  const updatePaginatedData = (data: OrderSearchData[]) => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedData(data.slice(startIndex, endIndex));
    setTotalPages(Math.ceil(data.length / itemsPerPage));
  };

  // 필터링된 데이터가 변경될 때 페이지네이션 업데이트
  useEffect(() => {
    updatePaginatedData(filteredData);
  }, [filteredData, currentPage]);

  // 주문번호 가공 함수
  const preprocessOrderNumber = (orderNumber: string): string => {
    const trimmed = orderNumber.trim();

    // '#' 포함 여부에 따라 다르게 처리
    if (trimmed.includes('#')) {
      // '#'가 있는 경우: '#' 이후의 첫 번째 '-' 이전까지만 사용
      // 예: HI-250918-0039#1-A → HI-250918-0039#1
      const parts = trimmed.split('#');
      if (parts.length === 2) {
        const beforeHash = parts[0]; // HI-250918-0039
        const afterHash = parts[1].split('-')[0]; // 1 (from 1-A)
        return `${beforeHash}#${afterHash}`;
      }
      return trimmed;
    } else {
      // '#'가 없는 경우: 세 번째 '-' 이후는 제거
      // 예: HI-250918-0039-B → HI-250918-0039
      // 예: HI-250918-0040-C → HI-250918-0040
      const parts = trimmed.split('-');
      if (parts.length > 3) {
        // 앞의 3개 부분만 사용 (HI, 250918, 0039)
        return parts.slice(0, 3).join('-');
      }
      return trimmed;
    }
  };

  // 검색 함수
  const performSearch = async () => {
    if (!searchTerm.trim()) {
      setFilteredData([]);
      setOrderData([]);
      setCurrentPage(1);
      return;
    }

    // 주문번호 모드일 때만 API 호출
    if (viewMode === 'orderNumber') {
      try {
        // 주문번호 가공
        const processedOrderNumber = preprocessOrderNumber(searchTerm);

        console.log('원본 주문번호:', searchTerm);
        console.log('가공된 주문번호:', processedOrderNumber);

        const response = await fetch('/api/search-order-info', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ searchTerm: processedOrderNumber }),
        });

        console.log('API 응답 상태:', response.status, response.statusText);
        const result = await response.json();
        console.log('API 응답 데이터:', result);

        if (result.success && result.data && result.data.length > 0) {
          // ID 추가하여 데이터 설정
          const dataWithId = result.data.map((item: any, index: number) => ({
            ...item,
            id: `${item.order_id || index}`,
          }));
          setOrderData(dataWithId);
          setFilteredData(dataWithId);
        } else {
          // 검색 결과가 없을 때
          setOrderData([]);
          setFilteredData([]);
          alert(result.message || '해당 주문번호의 정보를 찾을 수 없습니다.');
        }
        setCurrentPage(1);
      } catch (error) {
        console.error('검색 오류:', error);
        setOrderData([]);
        setFilteredData([]);
      }
    } else {
      // 기타 모드 (추후 구현)
      setFilteredData([]);
      setOrderData([]);
    }
  };

  // 검색어 변경
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
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

  // 뷰 모드 변경
  const handleViewModeChange = (mode: string) => {
    setViewMode(mode);
    setCurrentPage(1);
  };

  // 페이지 변경
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // 다음 페이지
  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // 이전 페이지
  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // 체크박스 핸들러
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(paginatedData.map(item => item.id));
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

  const isAllSelected = paginatedData.length > 0 && selectedRows.size === paginatedData.length;

  // 클릭하여 복사 핸들러
  const [showCopyToast, setShowCopyToast] = useState(false);

  const handleCopyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;

    // HTTP 환경에서도 작동하도록 fallback 추가
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setShowCopyToast(true);
        setTimeout(() => setShowCopyToast(false), 1500);
      }).catch(err => {
        console.error('복사 실패:', err);
        fallbackCopyToClipboard(text);
      });
    } else {
      fallbackCopyToClipboard(text);
    }
  };

  // HTTP 환경에서 사용할 fallback 복사 함수
  const fallbackCopyToClipboard = (text: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      setShowCopyToast(true);
      setTimeout(() => setShowCopyToast(false), 1500);
    } catch (err) {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    }

    document.body.removeChild(textArea);
  };

  // 엑셀 업로드 핸들러 (기능 없음 - 템플릿만)
  const handleExcelUpload = () => {
    alert('엑셀 업로드 기능은 추후 구현 예정입니다.');
  };

  return (
    <div className="order-search-layout">
      <TopsideMenu />
      <div className="order-search-main-content">
        <LeftsideMenu />
        <main className="order-search-content">
          <div className="order-search-container">
            <h1 className="order-search-title">{t('orderSearch.title')}</h1>

            {/* 컨트롤 섹션 */}
            <div className="order-search-control-section">
              <div className="order-search-left-controls"></div>
              <div className="order-search-right-controls">
                <button className="order-search-excel-upload-btn" onClick={handleExcelUpload}>
                  {t('orderSearch.excelUpload')}
                </button>
              </div>
            </div>

            {/* 검색 영역 */}
            <div className="order-search-section">
              <div className="order-search-board">
                <div className="order-search-view-mode-container">
                  <div className="order-search-radio-group">
                    <label className="order-search-radio-label">
                      <input
                        type="radio"
                        name="order-search-viewMode"
                        value="orderNumber"
                        checked={viewMode === 'orderNumber'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="order-search-radio-input"
                      />
                      {t('orderSearch.orderNumber')}
                    </label>
                    <label className="order-search-radio-label">
                      <input
                        type="radio"
                        name="order-search-viewMode"
                        value="other"
                        checked={viewMode === 'other'}
                        onChange={(e) => handleViewModeChange(e.target.value)}
                        className="order-search-radio-input"
                      />
                      {t('orderSearch.other')}
                    </label>
                  </div>
                </div>

                <div className="order-search-form-container">
                  <input
                    type="text"
                    placeholder={t('orderSearch.searchPlaceholder')}
                    value={searchTerm}
                    onChange={handleSearchInputChange}
                    onKeyPress={handleSearchKeyPress}
                    className="order-search-input"
                  />
                  <button onClick={handleSearchClick} className="order-search-button">
                    {t('orderSearch.search')}
                  </button>
                </div>
              </div>
            </div>

            {/* 테이블 영역 */}
            <div className="order-search-table-board">
              {filteredData.length === 0 ? (
                <div className="order-search-empty-data">{t('orderSearch.noResults')}</div>
              ) : (
                <table className="order-search-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="order-search-table-checkbox"
                        />
                      </th>
                      <th>{t('orderSearch.table.shop')}</th>
                      <th>{t('orderSearch.table.offerId')}</th>
                      <th>{t('orderSearch.table.deliveryStatus')}</th>
                      <th>{t('orderSearch.table.orderId')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(item.id)}
                            onChange={(e) => handleSelectRow(item.id, e.target.checked)}
                            className="order-search-table-checkbox"
                          />
                        </td>
                        <td
                          className="order-search-shop"
                          onClick={() => handleCopyToClipboard(item.shop || '', '업체명')}
                          title="클릭하여 복사"
                        >
                          {item.shop || ''}
                        </td>
                        <td
                          className="order-search-offer-id"
                          onClick={() => handleCopyToClipboard(item.offer_id || '', '상품코드')}
                          title="클릭하여 복사"
                        >
                          {item.offer_id || ''}
                        </td>
                        <td
                          className="order-search-delivery-status"
                          onClick={() => handleCopyToClipboard(item.delivery_status || '', '배송상태')}
                          title="클릭하여 복사"
                        >
                          {item.delivery_status || ''}
                        </td>
                        <td
                          className="order-search-order-id"
                          onClick={() => handleCopyToClipboard(item.order_id || '', '주문번호')}
                          title="클릭하여 복사"
                        >
                          {item.order_id || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="order-search-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="order-search-pagination-button"
                >
                  {t('orderSearch.pagination.previous')}
                </button>
                <div className="order-search-page-numbers">
                  {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
                    const startPage = Math.max(1, currentPage - 5);
                    const pageNum = startPage + i;
                    if (pageNum <= totalPages) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`order-search-page-number ${currentPage === pageNum ? 'active' : ''}`}
                        >
                          {pageNum}
                        </button>
                      );
                    }
                    return null;
                  })}
                </div>
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="order-search-pagination-button"
                >
                  {t('orderSearch.pagination.next')}
                </button>
                <div className="order-search-page-info">
                  {currentPage} / {totalPages}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* 복사 완료 토스트 */}
      {showCopyToast && (
        <div className="order-search-copy-toast">
          {t('orderSearch.copyToast')}
        </div>
      )}
    </div>
  );
};

export default OrderSearch;
