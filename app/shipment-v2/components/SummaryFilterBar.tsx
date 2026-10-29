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
// 칩 필터 — [전체] [품목별 개수…] | [쉽먼트에러] [A] [B] [C] [P] [X]
//   태그 클릭 → 해당 행만 보기, 같은 태그 재클릭 → 전체
//   품목은 한글 저장값으로 묶고 화면엔 영문(통관정보) / ❓ 로 표시
//   rows 는 상단 카드 보드 필터가 적용된 행 — 개수가 카드 선택과 함께 움직인다
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

  // ── 품목별 개수 (많은 순) + 영문명 ──
  const categorySummary = useMemo(() => {
    const map = new Map<string, { count: number; en: string | null }>();
    rows.forEach((r) => {
      const key = getCategoryKey(r);
      const prev = map.get(key);
      map.set(key, { count: (prev?.count ?? 0) + 1, en: prev?.en ?? r.customs_category_en });
    });
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
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
    ['sv2-chip', extra, isSameFilter(filter, target) ? 'is-active' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className="sv2-chips">
      {/* ── 전체 ── */}
      <button type="button" className={tagClass(FILTER_ALL)} onClick={() => onFilterChange(FILTER_ALL)}>
        {t('shipmentV2.summary.all')}
        <span className="sv2-chip-count">{rows.length}</span>
      </button>

      {/* ── 품목별 ── */}
      {categorySummary.map(([category, { count, en }]) => {
        const target: RowFilter = { kind: 'category', category };
        return (
          <button key={category || '__uncategorized'} type="button" className={tagClass(target)} onClick={() => handleClick(target)}>
            <CategoryLabel
              raw={category === UNCATEGORIZED ? null : category}
              en={en}
              emptyText={t('shipmentV2.summary.uncategorized')}
            />
            <span className="sv2-chip-count">{count}</span>
          </button>
        );
      })}

      <span className="sv2-chips-divider" aria-hidden="true" />

      {/* ── 쉽먼트에러: 전체 + 사이즈별 ── */}
      {(() => {
        const target: RowFilter = { kind: 'error', code: null };
        return (
          <button
            type="button"
            className={tagClass(target, errorSummary.total > 0 ? 'sv2-chip--error' : 'sv2-chip--muted')}
            onClick={() => handleClick(target)}
            title={t('shipmentV2.summary.shipmentErrorHint')}
          >
            {t('shipmentV2.summary.shipmentError')}
            <span className="sv2-chip-count">{errorSummary.total}</span>
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
            className={tagClass(target, count > 0 ? 'sv2-chip--error' : 'sv2-chip--muted')}
            onClick={() => handleClick(target)}
          >
            {code}
            <span className="sv2-chip-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SummaryFilterBar;
