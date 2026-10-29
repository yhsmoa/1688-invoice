'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipmentV2Row } from '../types';
import { SHIPMENT_SIZE_CODES, type ShipmentSizeCode } from '../utils/shipmentCodes';
import {
  FILTER_ALL,
  UNCATEGORIZED,
  getCategoryKey,
  isSameFilter,
  type RowFilter,
} from '../utils/rowFilter';
import CategoryLabel from './CategoryLabel';

// ============================================================
// 필터 패널 — 두 줄, 줄마다 무엇을 거르는지 라벨
//   [품목]          전체 · T SHIRT 184 · JACKET 151 … · ? 2 · 미분류 5
//   [사이즈 불일치] 전체 · A · B · C · P · X   (상품 사이즈 ≠ 담긴 박스 타입, 숫자는 상품 사이즈 기준)
//
//   칩 클릭 → 해당 행만, 같은 칩 재클릭 → 전체. 두 줄은 같은 칩 필터라 한 번에 하나만 켜진다.
//   rows 는 상단 타입 바 필터가 적용된 행 — 개수가 타입 바 선택과 함께 움직인다.
// ============================================================
interface SummaryFilterBarProps {
  rows: ShipmentV2Row[];
  /** rows 와 같은 순서의 사이즈 불일치(쉽먼트 에러) 코드 */
  rowErrors: (ShipmentSizeCode | null)[];
  filter: RowFilter;
  onFilterChange: (filter: RowFilter) => void;
}

const SummaryFilterBar: React.FC<SummaryFilterBarProps> = ({ rows, rowErrors, filter, onFilterChange }) => {
  const { t } = useTranslation();

  // ── 품목별 개수 (많은 순, 미분류는 맨 뒤) + 영문명 ──
  const categorySummary = useMemo(() => {
    const map = new Map<string, { count: number; en: string | null }>();
    rows.forEach((r) => {
      const key = getCategoryKey(r);
      const prev = map.get(key);
      map.set(key, { count: (prev?.count ?? 0) + 1, en: prev?.en ?? r.customs_category_en });
    });
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === UNCATEGORIZED) return 1;
      if (b[0] === UNCATEGORIZED) return -1;
      return b[1].count - a[1].count;
    });
  }, [rows]);

  // ── 사이즈 불일치 개수 (상품 사이즈별) ──
  const errorSummary = useMemo(() => {
    const counts = new Map<ShipmentSizeCode, number>(SHIPMENT_SIZE_CODES.map((c) => [c, 0]));
    rowErrors.forEach((code) => {
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    });
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return { counts, total };
  }, [rowErrors]);

  const handleClick = (next: RowFilter) => {
    onFilterChange(isSameFilter(filter, next) ? FILTER_ALL : next);
  };

  const chipClass = (target: RowFilter, extra = '') =>
    ['sv2-chip', extra, isSameFilter(filter, target) ? 'is-active' : ''].filter(Boolean).join(' ');

  const errorAll: RowFilter = { kind: 'error', code: null };

  return (
    <div className="sv2-filters">
      {/* ── 품목 ── */}
      <div className="sv2-filter-row">
        <span className="sv2-filter-label">{t('shipmentV2.summary.categoryLabel')}</span>
        <button type="button" className={chipClass(FILTER_ALL)} onClick={() => onFilterChange(FILTER_ALL)}>
          {t('shipmentV2.summary.all')}
          <span className="sv2-chip-count">{rows.length}</span>
        </button>
        {categorySummary.map(([category, { count, en }]) => {
          const target: RowFilter = { kind: 'category', category };
          return (
            <button key={category || '__uncategorized'} type="button" className={chipClass(target)} onClick={() => handleClick(target)}>
              <CategoryLabel
                raw={category === UNCATEGORIZED ? null : category}
                en={en}
                emptyText={t('shipmentV2.summary.uncategorized')}
              />
              <span className="sv2-chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="sv2-filters-divider" aria-hidden="true" />

      {/* ── 사이즈 불일치 (상품 사이즈 ≠ 박스 타입) ── */}
      <div className="sv2-filter-row">
        <span className="sv2-filter-label">{t('shipmentV2.summary.mismatchLabel')}</span>
        <button
          type="button"
          className={chipClass(errorAll, errorSummary.total > 0 ? 'sv2-chip--error' : 'sv2-chip--muted')}
          onClick={() => handleClick(errorAll)}
        >
          {t('shipmentV2.summary.all')}
          <span className="sv2-chip-count">{errorSummary.total}</span>
        </button>
        {SHIPMENT_SIZE_CODES.map((code) => {
          const count = errorSummary.counts.get(code) ?? 0;
          const target: RowFilter = { kind: 'error', code };
          return (
            <button
              key={code}
              type="button"
              className={chipClass(target, count > 0 ? 'sv2-chip--error' : 'sv2-chip--muted')}
              onClick={() => handleClick(target)}
            >
              {code}
              <span className="sv2-chip-count">{count}</span>
            </button>
          );
        })}
        <span className="sv2-filter-help">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          {t('shipmentV2.summary.mismatchHelp')}
        </span>
      </div>
    </div>
  );
};

export default SummaryFilterBar;
