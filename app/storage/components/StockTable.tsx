'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { StockRow } from '../types';
import ProductCell from './ProductCell';
import { AGED_DAYS } from '../hooks/StorageContext';
import { daysSince, formatDateTime } from '../utils/storageFormat';

// ============================================================
// StockTable — [재고] 상품 × 위치 표
//   체크 · 위치 · 상품 · 수량 · 첫 배치 · 보관일수
//   · 행 클릭 → 상세(원장 타임라인) / 체크박스 클릭은 상세를 열지 않는다
//   · 보관 30일 이상은 강조, 음수 수량은 원장 이상 신호로 빨강
// ============================================================

/** 체크 키 = 상품 × 위치 */
export const stockKey = (r: Pick<StockRow, 'product_id' | 'location_id'>) => `${r.product_id}|${r.location_id}`;

interface StockTableProps {
  rows: StockRow[];
  checked: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpenDetail: (row: StockRow) => void;
}

const StockTable: React.FC<StockTableProps> = ({ rows, checked, onToggle, onToggleAll, onOpenDetail }) => {
  const { t } = useTranslation();
  const selectable = rows.filter((r) => r.qty > 0);
  const allChecked = selectable.length > 0 && selectable.every((r) => checked.has(stockKey(r)));
  const now = new Date();

  return (
    <table className="storage-table">
      <thead>
        <tr>
          <th className="col-check">
            <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} />
          </th>
          <th className="col-location">{t('storage.col.location')}</th>
          <th>{t('storage.col.product')}</th>
          <th className="col-num">{t('storage.col.qty')}</th>
          <th className="col-date">{t('storage.col.firstPutaway')}</th>
          <th className="col-num">{t('storage.col.days')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const key = stockKey(r);
          const days = daysSince(r.first_putaway_at, now);
          const aged = days !== null && days >= AGED_DAYS;
          return (
            <tr
              key={key}
              className={`is-clickable ${checked.has(key) ? 'is-checked' : ''}`}
              onClick={() => onOpenDetail(r)}
            >
              <td className="col-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={checked.has(key)}
                  disabled={r.qty <= 0}
                  onChange={() => onToggle(key)}
                />
              </td>
              <td className="col-location"><span className="storage-location-code">{r.location_code}</span></td>
              <td><ProductCell info={r} /></td>
              <td className={`col-num is-strong ${r.qty < 0 ? 'is-negative' : ''}`}>{r.qty}</td>
              <td className="col-date">{formatDateTime(r.first_putaway_at)}</td>
              <td className={`col-num ${aged ? 'is-aged' : ''}`}>{days ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default StockTable;
