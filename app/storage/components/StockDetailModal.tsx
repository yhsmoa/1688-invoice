'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import type { LedgerRow, StockRow } from '../types';
import ProductCell from './ProductCell';
import { formatDateTime } from '../utils/storageFormat';

// ============================================================
// StockDetailModal — 상품 상세 + 원장 타임라인
//   GET /api/ft/storage/ledger (PUTAWAY / PICK / UNPACK / MOVE_OUT / MOVE_IN)
//   PICK·UNPACK 은 담긴 박스코드를 같이 표시
// ============================================================

interface StockDetailModalProps {
  row: StockRow;
  onClose: () => void;
}

const StockDetailModal: React.FC<StockDetailModalProps> = ({ row, onClose }) => {
  const { t } = useTranslation();
  const { userId } = useStorage();
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/ft/storage/ledger?user_id=${encodeURIComponent(userId)}&product_id=${encodeURIComponent(row.product_id)}`,
          { cache: 'no-store' }
        );
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error);
        setLedger(json.data as LedgerRow[]);
      } catch (err) {
        if (cancelled) return;
        console.error('원장 조회 오류:', err);
        setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, row.product_id]);

  return (
    <div className="storage-modal-overlay" onClick={onClose}>
      <div className="storage-modal storage-modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="storage-modal-head">
          <h3>{t('storage.detail.title')}</h3>
          <button type="button" className="storage-modal-x" onClick={onClose}>✕</button>
        </div>

        <ProductCell info={row} large />
        <div className="storage-detail-meta">
          <span>{t('storage.detail.itemNo')}: {row.item_no}</span>
          {row.barcode && <span>{t('storage.detail.barcode')}: {row.barcode}</span>}
        </div>

        {/* ── 원장 타임라인 ── */}
        {loadError ? (
          <div className="storage-empty is-error">{t('storage.loadError')}</div>
        ) : !ledger ? (
          <div className="storage-empty">{t('storage.loading')}</div>
        ) : (
          <table className="storage-table storage-table--compact">
            <thead>
              <tr>
                <th className="col-date">{t('storage.detail.at')}</th>
                <th>{t('storage.detail.kind')}</th>
                <th className="col-location">{t('storage.col.location')}</th>
                <th className="col-num">{t('storage.col.qty')}</th>
                <th>{t('storage.detail.box')}</th>
                <th>{t('storage.detail.operator')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.id}>
                  <td className="col-date">{formatDateTime(m.created_at)}</td>
                  <td><span className={`storage-kind is-${m.kind.toLowerCase()}`}>{t(`storage.kind.${m.kind}`)}</span></td>
                  <td className="col-location">{m.location_code}</td>
                  <td className={`col-num ${m.delta < 0 ? 'is-negative' : ''}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td>{m.outbound_box_code ?? ''}</td>
                  <td>{m.operator_name ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default StockDetailModal;
