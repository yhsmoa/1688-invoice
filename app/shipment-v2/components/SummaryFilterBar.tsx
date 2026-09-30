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

// ============================================================
// 요약 보드 — [전체] [품목별 개수…] | [쉽먼트에러] [A] [B] [C] [P] [X]
//   태그 클릭 → 해당 행만 보기, 같은 태그 재클릭 → 전체
// ============================================================
interface SummaryFilterBarProps {
  rows: ShipmentV2Row[];
  /** rows 와 같은 순서의 쉽먼트 에러 코드 */
  rowErrors: (ShipmentSizeCode | null)[];
  filter: RowFilter;
  onFilterChange: (filter: RowFilter) => void;
}

const SummaryFilterBar: React.FC<SummaryFilterBarProps> = ({ rows, rowErrors, filter, onFilterChange }) => {
  const { t } = useTranslation();

  // ── 품목별 개수 (많은 순) ──
  const categorySummary = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const key = getCategoryKey(r);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  // ── 쉽먼트에러 개수 (상품 사이즈별) ──
  const errorSummary = useMemo(() => {
    const counts = new Map<ShipmentSizeCode, number>(SHIPMENT_SIZE_CODES.map((c) => [c, 0]));
    rowErrors.forEach((code) => {
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    });
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return { counts, total };
  }, [rowErrors]);

  // ── 태그 클릭: 같은 필터면 해제 ──
  const handleClick = (next: RowFilter) => {
    onFilterChange(isSameFilter(filter, next) ? FILTER_ALL : next);
  };

  const tagClass = (target: RowFilter, extra = '') =>
    ['shipment-v2-category-tag', extra, isSameFilter(filter, target) ? 'shipment-v2-category-tag--active' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className="shipment-v2-category-summary">
      {/* ── 전체 ── */}
      <button type="button" className={tagClass(FILTER_ALL)} onClick={() => onFilterChange(FILTER_ALL)}>
        {t('shipmentV2.summary.all')}
        <span className="shipment-v2-category-count">({rows.length})</span>
      </button>

      {/* ── 품목별 ── */}
      {categorySummary.map(([category, count]) => {
        const target: RowFilter = { kind: 'category', category };
        return (
          <button key={category || '__uncategorized'} type="button" className={tagClass(target)} onClick={() => handleClick(target)}>
            {category === UNCATEGORIZED ? t('shipmentV2.summary.uncategorized') : category}
            <span className="shipment-v2-category-count">({count})</span>
          </button>
        );
      })}

      <span className="shipment-v2-summary-divider" aria-hidden="true" />

      {/* ── 쉽먼트에러: 전체 + 사이즈별 ── */}
      {(() => {
        const target: RowFilter = { kind: 'error', code: null };
        return (
          <button
            type="button"
            className={tagClass(target, errorSummary.total > 0 ? 'shipment-v2-error-tag--has' : 'shipment-v2-error-tag--none')}
            onClick={() => handleClick(target)}
            title={t('shipmentV2.summary.shipmentErrorHint')}
          >
            {t('shipmentV2.summary.shipmentError')}
            <span className="shipment-v2-error-count">({errorSummary.total})</span>
          </button>
        );
      })()}
      {SHIPMENT_SIZE_CODES.map((code) => {
        const count = errorSummary.counts.get(code) ?? 0;
        const target: RowFilter = { kind: 'error', code };
        return (
          <button
            key={code}
            type="button"
            className={tagClass(target, count > 0 ? 'shipment-v2-error-tag--has' : 'shipment-v2-error-tag--none')}
            onClick={() => handleClick(target)}
          >
            {code}
            <span className="shipment-v2-error-count">({count})</span>
          </button>
        );
      })}
    </div>
  );
};

export default SummaryFilterBar;
