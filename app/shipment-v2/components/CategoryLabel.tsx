'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { getCategoryDisplay } from '../utils/customsDisplay';

// ============================================================
// 품목 표시 — 통관정보 영문명 / 알 수 없음 ❓ / 미등록 한글
//   규칙은 utils/customsDisplay.ts. 테이블 셀과 요약 칩이 같이 쓴다.
// ============================================================
interface CategoryLabelProps {
  raw: string | null | undefined;
  en: string | null | undefined;
  /** 비어 있을 때 표시 (테이블 '-', 칩 '미분류') */
  emptyText: string;
}

const CategoryLabel: React.FC<CategoryLabelProps> = ({ raw, en, emptyText }) => {
  const { t } = useTranslation();
  const display = getCategoryDisplay(raw, en);

  switch (display.kind) {
    case 'empty':
      return <span className="sv2-cat sv2-cat--empty">{emptyText}</span>;
    case 'unknown':
      return (
        <span
          className="sv2-cat sv2-cat--unknown"
          role="img"
          aria-label={t('shipmentV2.category.unknown', { raw: display.raw })}
          title={t('shipmentV2.category.unknown', { raw: display.raw })}
        >
          ❓
        </span>
      );
    case 'en':
      return <span className="sv2-cat" title={display.raw}>{display.text}</span>;
    case 'unmapped':
      return (
        <span className="sv2-cat sv2-cat--unmapped" title={t('shipmentV2.category.unmapped')}>
          {display.raw}
          <span className="sv2-cat-dot" aria-hidden="true" />
        </span>
      );
  }
};

export default CategoryLabel;
