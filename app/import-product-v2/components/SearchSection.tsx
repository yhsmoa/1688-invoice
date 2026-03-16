'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// V2 전용 SearchSection 컴포넌트
// 1행: 상태 필터 (PROCESSING/ALL) + 미배송/지연배송 필터
// 2행: 검색 폼 (검색유형 드롭박스 + 검색입력 + 검색 버튼)
// ============================================================

interface SearchSectionProps {
  // ── 검색 ──
  searchType: string;
  searchTerm: string;
  onSearchTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onSearchInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchKeyPress: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSearchClick: () => void;
  isSearching?: boolean;
  // ── 상태 필터 (PROCESSING/ALL) ──
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  filteredItemsCount: number;
  // ── 미배송/지연배송 필터 ──
  noDeliveryFilter: boolean;
  delayedDeliveryFilter: boolean;
  onNoDeliveryFilterChange: (active: boolean) => void;
  onDelayedDeliveryFilterChange: (active: boolean) => void;
  noDeliveryCount: number;
  delayedDeliveryCount: number;
}

const SearchSection: React.FC<SearchSectionProps> = ({
  searchType,
  searchTerm,
  onSearchTypeChange,
  onSearchInputChange,
  onSearchKeyPress,
  onSearchClick,
  isSearching = false,
  statusFilter,
  onStatusFilterChange,
  filteredItemsCount,
  noDeliveryFilter,
  delayedDeliveryFilter,
  onNoDeliveryFilterChange,
  onDelayedDeliveryFilterChange,
  noDeliveryCount,
  delayedDeliveryCount,
}) => {
  const { t } = useTranslation();

  return (
    <div className="v2-search-section">
      <div className="v2-search-board">
        {/* ── 1행: 필터 버튼들 ── */}
        <div className="v2-search-filter-row">
          {/* PROCESSING / ALL 라디오 */}
          <label
            className={`v2-status-filter-radio ${statusFilter === 'PROCESSING' ? 'active' : ''}`}
          >
            <input
              type="radio"
              name="statusFilter"
              checked={statusFilter === 'PROCESSING'}
              onChange={() => onStatusFilterChange('PROCESSING')}
            />
            PROCESSING
          </label>
          <label
            className={`v2-status-filter-radio ${statusFilter === 'ALL' ? 'active' : ''}`}
          >
            <input
              type="radio"
              name="statusFilter"
              checked={statusFilter === 'ALL'}
              onChange={() => onStatusFilterChange('ALL')}
            />
            ALL
          </label>

          {/* 구분선 */}
          <span className="v2-filter-divider">|</span>

          {/* 미배송 토글 버튼 (라디오 스타일) */}
          <label
            className={`v2-status-filter-radio ${noDeliveryFilter ? 'active' : ''}`}
            onClick={() => onNoDeliveryFilterChange(!noDeliveryFilter)}
          >
            {noDeliveryCount > 0 && '⚠️ '}미배송({noDeliveryCount})
          </label>

          {/* 지연배송 토글 버튼 (라디오 스타일) */}
          <label
            className={`v2-status-filter-radio ${delayedDeliveryFilter ? 'active' : ''}`}
            onClick={() => onDelayedDeliveryFilterChange(!delayedDeliveryFilter)}
          >
            {delayedDeliveryCount > 0 && '⚠️ '}지연배송({delayedDeliveryCount})
          </label>

          {/* 전체 건수 */}
          {statusFilter === 'ALL' && (
            <span className="v2-status-filter-count">
              전체 {filteredItemsCount}건
            </span>
          )}
        </div>

        {/* ── 2행: 검색 폼 ── */}
        <div className="v2-search-form-container">
          <select
            className="v2-search-dropdown"
            value={searchType}
            onChange={onSearchTypeChange}
          >
            <option value="배송번호">{t('importProduct.searchType.deliveryNumber')}</option>
            <option value="주문번호">주문번호</option>
            <option value="일반검색">{t('importProduct.searchType.general')}</option>
          </select>
          <input
            type="text"
            placeholder={
              searchType === '배송번호' ? t('importProduct.searchPlaceholder.deliveryNumber')
              : searchType === '주문번호' ? '1688 주문번호 입력'
              : t('importProduct.searchPlaceholder.general')
            }
            className="v2-search-input"
            value={searchTerm}
            onChange={onSearchInputChange}
            onKeyPress={onSearchKeyPress}
          />
          <button
            className="v2-search-button"
            onClick={onSearchClick}
            disabled={isSearching}
          >
            {isSearching ? '조회 중...' : t('importProduct.search')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SearchSection;
