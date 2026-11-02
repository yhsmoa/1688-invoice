'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import type { StockRow } from '../types';
import ProductCell from './ProductCell';
import { playErrorSound } from '../utils/storageFormat';

// ============================================================
// StockMoveModal — 위치 이동 (잘못 넣었거나 칸 정리)
//   새 위치 스캔(Enter) → 수량(기본 = 그 칸 전량) → [이동]
//   POST /api/ft/storage/move — 새 위치는 자동 등록
// ============================================================

interface StockMoveModalProps {
  row: StockRow;
  onClose: (moved: boolean) => void;
}

const StockMoveModal: React.FC<StockMoveModalProps> = ({ row, onClose }) => {
  const { t } = useTranslation();
  const { userId, worker } = useStorage();
  const [toLocation, setToLocation] = useState('');
  const [qtyText, setQtyText] = useState(String(row.qty));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const qty = Number(qtyText);
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= row.qty;

  const handleMove = async () => {
    if (saving || !worker || !toLocation.trim() || !qtyValid) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/ft/storage/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          product_id: row.product_id,
          from_location_id: row.location_id,
          to_location_code: toLocation,
          qty,
          operator_name: worker,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        playErrorSound();
        setError(json.error || t('storage.move.error'));
        return;
      }
      onClose(true);
    } catch (err) {
      console.error('위치 이동 오류:', err);
      playErrorSound();
      setError(t('storage.move.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal" role="dialog" aria-label={t('storage.move.title')}>
        <div className="storage-modal-head">
          <h3>{t('storage.move.title')}</h3>
          <button type="button" className="storage-modal-x" onClick={() => onClose(false)} disabled={saving}>✕</button>
        </div>

        <ProductCell info={row} large />

        <div className="storage-modal-row">
          <div className="storage-modal-field">
            <label>{t('storage.move.from')}</label>
            <div className="storage-readonly">{row.location_code} ({row.qty})</div>
          </div>
          <div className="storage-modal-field">
            <label>{t('storage.move.to')}</label>
            <input
              className="storage-input storage-input--location"
              value={toLocation}
              autoFocus
              placeholder={t('storage.putaway.locationPlaceholder')}
              onChange={(e) => setToLocation(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleMove(); } }}
              disabled={saving}
            />
          </div>
          <div className="storage-modal-field">
            <label>{t('storage.putaway.qty')}</label>
            <input
              type="number"
              className="storage-input storage-input--qty"
              min={1}
              max={row.qty}
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              onFocus={(e) => e.target.select()}
              disabled={saving}
            />
          </div>
        </div>

        {error && <div className="storage-message is-error">{error}</div>}
        {!worker && <div className="storage-message is-error">{t('storage.needWorker')}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => onClose(false)} disabled={saving}>
            {t('storage.close')}
          </button>
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            onClick={handleMove}
            disabled={saving || !worker || !toLocation.trim() || !qtyValid}
          >
            {saving ? t('storage.saving') : t('storage.move.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockMoveModal;
