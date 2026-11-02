'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import type { StockRow } from '../types';
import ProductCell from './ProductCell';
import { playErrorSound } from '../utils/storageFormat';

// ============================================================
// StockAdjustModal — 재고 수량 수정 (실사 불일치 · 잘못 센 수량 · 파손/분실)
//   칸(상품 × 위치) 하나의 "새 수량" 과 사유를 받아 POST /api/ft/storage/adjust
//   → 원장에 차이만큼 ADJUST 기록 (이력 탭 "조정"). 사유는 필수.
// ============================================================

interface StockAdjustModalProps {
  row: StockRow;
  onClose: (changed: boolean) => void;
}

/** 자주 쓰는 사유 — 고르면 입력창에 채워지고, 직접 고쳐 쓸 수 있다 */
const REASON_PRESETS = ['실사 불일치', '배치 수량 오류', '파손', '분실', '반품 반출'] as const;

const StockAdjustModal: React.FC<StockAdjustModalProps> = ({ row, onClose }) => {
  const { t } = useTranslation();
  const { userId, worker } = useStorage();
  const [qtyText, setQtyText] = useState(String(row.qty));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const qty = Number(qtyText);
  const qtyValid = Number.isInteger(qty) && qty >= 0;
  const delta = qtyValid ? qty - row.qty : 0;
  const canSave = !saving && !!worker && qtyValid && delta !== 0 && note.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/ft/storage/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          product_id: row.product_id,
          location_id: row.location_id,
          new_qty: qty,
          note: note.trim(),
          operator_name: worker,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        playErrorSound();
        setError(json.error || t('storage.adjust.error'));
        return;
      }
      onClose(true);
    } catch (err) {
      console.error('재고 수량 수정 오류:', err);
      playErrorSound();
      setError(t('storage.adjust.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal" role="dialog" aria-label={t('storage.adjust.title')}>
        <div className="storage-modal-head">
          <h3>{t('storage.adjust.title')}</h3>
          <button type="button" className="storage-modal-x" onClick={() => onClose(false)} disabled={saving}>✕</button>
        </div>

        <ProductCell info={row} large />

        <div className="storage-modal-row">
          <div className="storage-modal-field">
            <label>{t('storage.col.location')}</label>
            <div className="storage-readonly">{row.location_code}</div>
          </div>
          <div className="storage-modal-field">
            <label>{t('storage.adjust.current')}</label>
            <div className="storage-readonly">{row.qty}</div>
          </div>
          <div className="storage-modal-field">
            <label>{t('storage.adjust.newQty')}</label>
            <input
              type="number"
              className="storage-input storage-input--qty"
              min={0}
              value={qtyText}
              autoFocus
              onChange={(e) => setQtyText(e.target.value)}
              onFocus={(e) => e.target.select()}
              disabled={saving}
            />
          </div>
        </div>
        <div className={`storage-hint ${delta !== 0 ? 'storage-adjust-delta' : ''}`}>
          {qtyValid && delta !== 0
            ? t('storage.adjust.deltaHint', { delta: delta > 0 ? `+${delta}` : String(delta) })
            : t('storage.adjust.noChange')}
        </div>

        {/* ── 사유 ── */}
        <div className="storage-modal-field">
          <label>{t('storage.adjust.reason')}</label>
          <div className="storage-suggest">
            {REASON_PRESETS.map((r) => (
              <button
                key={r}
                type="button"
                className={`storage-suggest-chip ${note === r ? 'is-barcode' : ''}`}
                onClick={() => setNote(r)}
                disabled={saving}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            className="storage-input"
            value={note}
            placeholder={t('storage.adjust.reasonPlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
            disabled={saving}
          />
        </div>

        {error && <div className="storage-message is-error">{error}</div>}
        {!worker && <div className="storage-message is-error">{t('storage.needWorker')}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => onClose(false)} disabled={saving}>
            {t('storage.close')}
          </button>
          <button type="button" className="storage-btn storage-btn--primary" onClick={handleSave} disabled={!canSave}>
            {saving ? t('storage.saving') : t('storage.adjust.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockAdjustModal;
