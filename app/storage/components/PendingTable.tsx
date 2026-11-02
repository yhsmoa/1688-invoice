'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PendingRow } from '../types';
import ProductCell from './ProductCell';
import { formatDateTime } from '../utils/storageFormat';

// ============================================================
// PendingTable — [작업중] 입고 줄 표
//   입고일 · 입고 담당 · 상품(사진·옵션·중국어옵션) · 입고 · 배치됨 · 미배치 · [배치]
//   한 줄 = 입고 건 (세트면 "완성 세트 수를 늘린 입고 건")
// ============================================================

interface PendingTableProps {
  rows: PendingRow[];
  onPlace: (productId: string) => void;
}

const PendingTable: React.FC<PendingTableProps> = ({ rows, onPlace }) => {
  const { t } = useTranslation();

  return (
    <table className="storage-table">
      <thead>
        <tr>
          <th className="col-date">{t('storage.col.arrivedAt')}</th>
          <th className="col-operator">{t('storage.col.operator')}</th>
          <th>{t('storage.col.product')}</th>
          <th className="col-num">{t('storage.col.arrivalQty')}</th>
          <th className="col-num">{t('storage.col.placed')}</th>
          <th className="col-num">{t('storage.col.unplaced')}</th>
          <th className="col-action" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.inbound_id}>
            <td className="col-date">{formatDateTime(r.arrived_at)}</td>
            <td className="col-operator">{r.arrival_operator}</td>
            <td><ProductCell info={r} /></td>
            <td className="col-num">{r.line_qty}</td>
            <td className="col-num">{r.line_qty - r.line_unplaced || ''}</td>
            <td className="col-num is-strong">{r.line_unplaced}</td>
            <td className="col-action">
              <button type="button" className="storage-btn storage-btn--primary" onClick={() => onPlace(r.product_id)}>
                {t('storage.pending.place')}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default PendingTable;
