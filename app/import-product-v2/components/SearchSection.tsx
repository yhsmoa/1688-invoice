'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// V2 전용 SearchSection 컴포넌트
// 1행: 상태 필터 (PROCESSING/ALL) + [상품별로 보기] 체크박스
// 2행: 검색 폼 (검색유형 드롭박스 + 검색입력 + 검색 버튼)
//
// [상품별로 보기] 동작:
//   - 항상 클릭 가능 (페이지 접속 시 기본 해제)
//   - 체크 시 클라이언트에서 product_id(offer_id) ASC → item_no ASC 로 정렬
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
  // ── 상품별로 보기 (정렬 전환, 클라이언트 처리) ──
  groupByProduct: boolean;
  onGroupByProductChange: (value: boolean) => void;
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
  groupByProduct,
  onGroupByProductChange,
}) => {
  const { t } = useTranslation();

  return (
    <div className="v2-search-section">
      {/* ── 선택형 컨트롤 (보드 없이 좌상단) ── */}
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

          {/* 상품별로 보기 체크박스 — 항상 클릭 가능, 기본 해제 */}
          <label
            className={`v2-status-filter-radio ${groupByProduct ? 'active' : ''}`}
          >
            <input
              type="checkbox"
              checked={groupByProduct}
              onChange={(e) => onGroupByProductChange(e.target.checked)}
            />
            {t('importProductV2.filter.groupByProduct')}
          </label>

          {/* 검색유형 드롭박스 (선택형 — 좌상단 배치) */}
          <select
            className="v2-search-dropdown"
            value={searchType}
            onChange={onSearchTypeChange}
          >
            <option value="배송번호">{t('importProductV2.searchType.delivery')}</option>
            <option value="주문번호">{t('importProductV2.searchType.order')}</option>
            <option value="일반검색">{t('importProductV2.searchType.general')}</option>
            <option value="비고검색">{t('importProductV2.searchType.note')}</option>
          </select>

          {/* 전체 건수 */}
          {statusFilter === 'ALL' && (
            <span className="v2-status-filter-count">
              전체 {filteredItemsCount}건
            </span>
          )}
        </div>

      {/* ── 알약형 검색 입력 — 아이콘 클릭 / Enter 로 검색 ── */}
      <div className="v2-search-pill">
          <button
            type="button"
            className="v2-search-pill-icon-btn"
            onClick={onSearchClick}
            disabled={isSearching}
            aria-label={t('importProductV2.search')}
          >
            {isSearching ? (
              <span className="v2-spinner" />
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
              </svg>
            )}
          </button>
          <input
            type="text"
            placeholder={
              searchType === '배송번호' ? t('importProductV2.searchPlaceholder.delivery')
              : searchType === '주문번호' ? t('importProductV2.searchPlaceholder.order')
              : searchType === '비고검색' ? t('importProductV2.searchPlaceholder.note')
              : t('importProductV2.searchPlaceholder.general')
            }
            className="v2-search-pill-input"
            value={searchTerm}
            onChange={onSearchInputChange}
            onKeyPress={onSearchKeyPress}
          />
        </div>
    </div>
  );
};

export default SearchSection;
