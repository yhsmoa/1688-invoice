'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

/* V2 전용 ControlBar 컴포넌트 - 모든 className에 v2- 접두사 */

interface ControlBarProps {
  sortType: string;
  readyItemsCount: number;
  onSortTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onProcessReadyClick: () => void;
  onBarcodeClick: () => void;
  onBarcodeDBClick: () => void;
}

const ControlBar: React.FC<ControlBarProps> = ({
  sortType,
  readyItemsCount,
  onSortTypeChange,
  onProcessReadyClick,
  onBarcodeClick,
  onBarcodeDBClick
}) => {
  const { t } = useTranslation();

  return (
    <div className="v2-control-section">
      <div className="v2-left-controls">
        <select
          className="v2-sort-dropdown"
          value={sortType}
          onChange={onSortTypeChange}
        >
          <option value="주문순서">{t('importProduct.sortOrder')}</option>
          <option value="품목별">{t('importProduct.sortByProduct')}</option>
        </select>
      </div>
      <div className="v2-right-controls">
        <button className="v2-barcode-btn" onClick={onBarcodeClick}>
          {t('importProduct.generateBarcode')}
        </button>
        <button className="v2-barcode-btn-db" onClick={onBarcodeDBClick}>
          {t('importProduct.generateBarcodeDB')}
        </button>
        <button
          className={`v2-process-ready-btn ${readyItemsCount > 0 ? 'has-items' : ''}`}
          onClick={onProcessReadyClick}
        >
          {t('importProduct.processReady.button')} {readyItemsCount > 0 && `(${readyItemsCount})`}
        </button>
      </div>
    </div>
  );
};

export default ControlBar;
