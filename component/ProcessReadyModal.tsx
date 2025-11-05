'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ProcessReadyModal.css';

interface ReadyItem {
  id: string;
  img_url: string | null;
  order_number: string;
  barcode: string;
  product_name: string;
  order_option: string;
  progress: string | null;
  import_qty: number | null;
  cancel_qty: number | null;
  memo: string | null;
  barcode_qty: number;
  original_import_qty: number | null;
  modifiedFields: {
    import_qty?: number | null;
    cancel_qty?: number | null;
    memo?: string | null;
  };
}

interface ProcessReadyModalProps {
  isOpen: boolean;
  onClose: () => void;
  readyItems: ReadyItem[];
  onBarcodeQtyChange: (itemId: string, newQty: number) => void;
  onSave: () => void;
}

const ProcessReadyModal: React.FC<ProcessReadyModalProps> = ({
  isOpen,
  onClose,
  readyItems,
  onBarcodeQtyChange,
  onSave,
}) => {
  const { t } = useTranslation();
  const [editingBarcodeId, setEditingBarcodeId] = useState<string | null>(null);
  const [barcodeInputValue, setBarcodeInputValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleBarcodeIncrease = (itemId: string, currentQty: number) => {
    onBarcodeQtyChange(itemId, currentQty + 1);
  };

  const handleBarcodeDecrease = (itemId: string, currentQty: number) => {
    if (currentQty > 0) {
      onBarcodeQtyChange(itemId, currentQty - 1);
    }
  };

  const handleBarcodeClick = (itemId: string, currentQty: number) => {
    setEditingBarcodeId(itemId);
    setBarcodeInputValue(currentQty.toString());
  };

  const handleBarcodeInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value.length <= 3) {
      setBarcodeInputValue(value);
    }
  };

  const handleBarcodeInputBlur = (itemId: string) => {
    const newQty = parseInt(barcodeInputValue) || 0;
    onBarcodeQtyChange(itemId, newQty);
    setEditingBarcodeId(null);
  };

  const handleBarcodeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, itemId: string) => {
    if (e.key === 'Enter') {
      const newQty = parseInt(barcodeInputValue) || 0;
      onBarcodeQtyChange(itemId, newQty);
      setEditingBarcodeId(null);
    } else if (e.key === 'Escape') {
      setEditingBarcodeId(null);
    }
  };

  return (
    <>
      {/* 배경 오버레이 */}
      <div className="process-ready-overlay" onClick={onClose}></div>

      {/* 슬라이드 모달 */}
      <div className={`process-ready-modal ${isOpen ? 'open' : ''}`}>
        <div className="process-ready-header">
          <h2>{t('importProduct.processReady.modalTitle')}</h2>
          <button className="close-button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="process-ready-content">
          {readyItems.length === 0 ? (
            <div className="empty-message">
              {t('importProduct.processReady.emptyMessage')}
            </div>
          ) : (
            <div className="ready-items-list">
              {readyItems.map((item) => {
                const progressQty = parseInt(item.progress || '0');
                const importQty = item.modifiedFields.import_qty !== undefined
                  ? item.modifiedFields.import_qty
                  : item.import_qty;
                const cancelQty = item.modifiedFields.cancel_qty !== undefined
                  ? item.modifiedFields.cancel_qty
                  : item.cancel_qty;
                const memo = item.modifiedFields.memo !== undefined
                  ? item.modifiedFields.memo
                  : item.memo;
                const barcodeQty = item.barcode_qty;

                return (
                  <div key={item.id} className="ready-item">
                    {/* 이미지 - 가운데 배치 */}
                    <div className="ready-item-image">
                      {item.img_url ? (
                        <img
                          src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                          alt={item.product_name}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/placeholder.svg';
                          }}
                        />
                      ) : (
                        <div className="no-image">No Image</div>
                      )}
                    </div>

                    {/* 상품 정보 */}
                    <div className="ready-item-info">
                      {/* 글번호 | 바코드 */}
                      <div className="order-barcode-row">
                        <span>{item.order_number}</span>
                        <span className="separator">|</span>
                        <span>{item.barcode}</span>
                      </div>

                      {/* 상품명 */}
                      <div className="product-name">
                        {item.product_name}
                      </div>

                      {/* 주문옵션 - 상품명 아래 */}
                      {item.order_option && (
                        <div className="order-option-badge">
                          {item.order_option}
                        </div>
                      )}

                      {/* 진행, 입고, 취소, 바코드(개수) - 한줄 표시 */}
                      <div className="stats-row">
                        <div className="stat-item">
                          <span className="stat-label">{t('importProduct.processReady.progress')}</span>
                          <span className={`stat-value ${progressQty === 0 ? 'zero' : ''}`}>
                            {progressQty}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">{t('importProduct.processReady.import')}</span>
                          <span className={`stat-value ${(importQty === null || importQty === 0) ? 'zero' : 'import'}`}>
                            {importQty ?? 0}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">{t('importProduct.processReady.cancel')}</span>
                          <span className={`stat-value ${(cancelQty === null || cancelQty === 0) ? 'zero' : 'cancel'}`}>
                            {cancelQty ?? 0}
                          </span>
                        </div>
                        <div className="stat-item barcode-control">
                          <span className="stat-label">{t('importProduct.processReady.barcode')}</span>
                          <div className="barcode-quantity-controls">
                            <button
                              className="barcode-btn-minus"
                              onClick={() => handleBarcodeDecrease(item.id, barcodeQty)}
                              disabled={barcodeQty === 0}
                            >
                              −
                            </button>
                            {editingBarcodeId === item.id ? (
                              <input
                                type="text"
                                className="barcode-qty-input"
                                value={barcodeInputValue}
                                onChange={handleBarcodeInputChange}
                                onBlur={() => handleBarcodeInputBlur(item.id)}
                                onKeyDown={(e) => handleBarcodeInputKeyDown(e, item.id)}
                                autoFocus
                                maxLength={3}
                              />
                            ) : (
                              <span
                                className={`stat-value barcode-clickable ${barcodeQty === 0 ? 'zero' : ''}`}
                                onClick={() => handleBarcodeClick(item.id, barcodeQty)}
                              >
                                {barcodeQty}
                              </span>
                            )}
                            <button
                              className="barcode-btn-plus"
                              onClick={() => handleBarcodeIncrease(item.id, barcodeQty)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* 비고 - 통계 아래 */}
                      {memo && (
                        <div className="note-row">
                          <span className="note-label">비고:</span>
                          <span className="note-content">{memo}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="process-ready-footer">
          <div className="footer-info">
            {t('importProduct.processReady.totalItems')} {readyItems.length}{t('importProduct.processReady.itemsCount')}
          </div>
          <button
            className="save-ready-button"
            onClick={handleSave}
            disabled={readyItems.length === 0 || isSaving}
          >
            {isSaving ? (
              <span className="button-loading">
                <span className="spinner"></span>
                {t('importProduct.processReady.save')}
              </span>
            ) : (
              t('importProduct.processReady.save')
            )}
          </button>
        </div>
      </div>
    </>
  );
};

export default ProcessReadyModal;
