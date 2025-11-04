'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

interface ControlBarProps {
  sortType: string;
  readyItemsCount: number;
  modifiedDataCount: number;
  isSaving: boolean;
  onSortTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onProcessReadyClick: () => void;
  onSaveClick: () => void;
  onBarcodeClick: () => void;
  onBarcodeDBClick: () => void;
}

const ControlBar: React.FC<ControlBarProps> = ({
  sortType,
  readyItemsCount,
  modifiedDataCount,
  isSaving,
  onSortTypeChange,
  onProcessReadyClick,
  onSaveClick,
  onBarcodeClick,
  onBarcodeDBClick
}) => {
  const { t } = useTranslation();

  return (
    <div className="control-section">
      <div className="left-controls">
        <select
          className="sort-dropdown"
          value={sortType}
          onChange={onSortTypeChange}
        >
          <option value="주문순서">{t('importProduct.sortOrder')}</option>
          <option value="품목별">{t('importProduct.sortByProduct')}</option>
        </select>
      </div>
      <div className="right-controls">
        <button
          className={`process-ready-btn ${readyItemsCount > 0 ? 'has-items' : ''}`}
          onClick={onProcessReadyClick}
        >
          {t('importProduct.processReady.button')} {readyItemsCount > 0 && `(${readyItemsCount})`}
        </button>
        <button
          className={`excel-download-btn ${modifiedDataCount > 0 ? 'active' : ''}`}
          onClick={onSaveClick}
          disabled={modifiedDataCount === 0 || isSaving}
        >
          {isSaving ? t('importProduct.saving') : t('importProduct.save')}
        </button>
        <button className="barcode-btn" onClick={onBarcodeClick}>
          {t('importProduct.generateBarcode')}
        </button>
        <button className="barcode-btn-db" onClick={onBarcodeDBClick}>
          {t('importProduct.generateBarcodeDB')}
        </button>
      </div>
    </div>
  );
};

export default ControlBar;
