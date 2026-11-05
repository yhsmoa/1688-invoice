'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================
// V2 전용 SearchSection 컴포넌트 (상품입고 V3 도 같이 쓴다)
// 1행: 상태 필터 (PROCESSING/ALL 세그먼트) + [그룹별로 보기] 체크박스 + 건수 + 우측 액션 버튼
// 2행: 검색 컨트롤 한 덩어리 — [검색유형 ▾ | 입력 | 검색]
//
// [그룹별로 보기] 동작 (상품입고 V2):
//   - 항상 클릭 가능 (페이지 접속 시 기본 체크)
//   - 체크 시 상품·옵션 그룹(보드)마다 테이블을 나눠 그린다 — 정렬 자체는 체크와 무관하게
//     항상 그룹 순서 (utils/groupBoards)
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

  // ── 그룹별로 보기 (보드 분할 토글, 클라이언트 처리) ──
  groupByProduct: boolean;
  onGroupByProductChange: (value: boolean) => void;
  /** 토글 체크박스 문구 — 미지정 시 "그룹별로 보기" */
  groupToggleLabel?: string;
  /** false 면 그룹 토글을 숨긴다 (V3 는 항상 그룹 보기) — 기본 true */
  showGroupToggle?: boolean;

  // ── 우측 액션 버튼들 (1688 XLSX ~ 주문 ID) — 필터행 오른쪽 ──
  rightButtons?: React.ReactNode;
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
  groupToggleLabel,
  showGroupToggle = true,
  rightButtons,
}) => {
  const { t } = useTranslation();

  const placeholder =
    searchType === '배송번호' ? t('importProductV2.searchPlaceholder.delivery')
    : searchType === '주문번호' ? t('importProductV2.searchPlaceholder.order')
    : searchType === '비고검색' ? t('importProductV2.searchPlaceholder.note')
    : t('importProductV2.searchPlaceholder.general');

  return (
    <section className="v2-search-section" aria-label={t('importProductV2.search')}>
      {/* ── 1행: 상태 세그먼트 · 상품별로 보기 · 건수 · 액션 버튼 ── */}
      <div className="v2-search-filter-row">
        <div className="v2-seg" role="radiogroup" aria-label="status">
          <label className={`v2-seg-btn ${statusFilter === 'PROCESSING' ? 'active' : ''}`}>
            <input
              type="radio"
              name="statusFilter"
              checked={statusFilter === 'PROCESSING'}
              onChange={() => onStatusFilterChange('PROCESSING')}
            />
            PROCESSING
          </label>
          <label className={`v2-seg-btn ${statusFilter === 'ALL' ? 'active' : ''}`}>
            <input
              type="radio"
              name="statusFilter"
              checked={statusFilter === 'ALL'}
              onChange={() => onStatusFilterChange('ALL')}
            />
            ALL
          </label>
        </div>

        {/* 그룹별로 보기 체크박스 — V3 는 숨김(항상 그룹 보기) */}
        {showGroupToggle && (
          <label className="v2-check">
            <input
              type="checkbox"
              checked={groupByProduct}
              onChange={(e) => onGroupByProductChange(e.target.checked)}
            />
            {groupToggleLabel ?? t('importProductV2.filter.groupView')}
          </label>
        )}

        {/* 전체 건수 */}
        {statusFilter === 'ALL' && (
          <span className="v2-status-filter-count">전체 {filteredItemsCount}건</span>
        )}

        {/* 액션 버튼(1688 XLSX ~ 주문 ID) — 필터행 오른쪽 */}
        {rightButtons && <div className="v2-search-action-buttons">{rightButtons}</div>}
      </div>

      {/* ── 2행: [검색유형 ▾ | 입력 | 검색] 한 덩어리 — 아이콘 클릭 / Enter 로 검색 ── */}
      <div className="v2-search-control">
        <select
          className="v2-search-control-type"
          value={searchType}
          onChange={onSearchTypeChange}
          aria-label={t('importProductV2.searchType.delivery')}
        >
          <option value="배송번호">{t('importProductV2.searchType.delivery')}</option>
          <option value="주문번호">{t('importProductV2.searchType.order')}</option>
          <option value="일반검색">{t('importProductV2.searchType.general')}</option>
          <option value="비고검색">{t('importProductV2.searchType.note')}</option>
        </select>
        <input
          type="text"
          placeholder={placeholder}
          className="v2-search-control-input"
          value={searchTerm}
          onChange={onSearchInputChange}
          onKeyPress={onSearchKeyPress}
          aria-label={t('importProductV2.search')}
        />
        <button
          type="button"
          className="v2-search-control-btn"
          onClick={onSearchClick}
          disabled={isSearching}
        >
          {isSearching ? (
            <span className="v2-spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
            </svg>
          )}
          {t('importProductV2.search')}
        </button>
      </div>
    </section>
  );
};

export default SearchSection;
