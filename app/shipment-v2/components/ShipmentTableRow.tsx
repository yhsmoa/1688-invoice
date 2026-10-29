'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomsOption } from '../hooks/useCustomsOptions';
import type { ShipmentV2Row } from '../types';
import type { ShipmentSizeCode } from '../utils/shipmentCodes';
import CategoryLabel from './CategoryLabel';
import MoveRequestButton, { type CompletedRequest } from './MoveRequestButton';

// ============================================================
// ShipmentTableRow — 쉽먼트 V2 표의 한 행 (포장 행 1건)
//
//   [박스 칸 — 묶음 첫 행만, ShipmentTable 이 만들어 넘김] | ☐ | 주문번호 | 바코드 | 상품정보 + 이동요청 |
//   주문옵션 | 단가 | 품목(영문/?, 클릭 → 영문 드롭다운) | 사이즈 | 입고 | 스캔(클릭 편집) | 전체
//
//   · 품목은 화면에서 전부 영문. 드롭다운도 영문으로 보이고, 고른 값은 한글 키(통관정보와 같은 키)로
//     부모가 dirty 로 모아 [저장] 때 일괄 PATCH (기존 저장 경로 유지)
//   · 지금 값이 통관정보에 없는 품목(미등록·알 수 없음)이면 그 값도 드롭다운에 남겨 둔다
//   · 스캔 편집은 화면 값만 바꾼다 (기존 동작 유지 — 저장 경로 없음)
//   · 부자재([생성]) 행은 품목·스캔 편집 불가 — order_item 이 없어 저장 대상이 아니다
//   · 행 상태 표시: 체크(파랑 바탕) / 입고≠전체(주황 바탕 + 왼쪽 띠) / 이동요청(보라 왼쪽 띠)
// ============================================================
interface ShipmentTableRowProps {
  row: ShipmentV2Row;
  idx: number;
  /** 묶음 첫 행이면 박스 칸(rowSpan), 아니면 null */
  boxCell: React.ReactNode;
  sizeError: ShipmentSizeCode | null;
  isChecked: boolean;
  completed: CompletedRequest | undefined;
  customsOptions: CustomsOption[];
  doneBy: string;
  onToggleCheck: (rowId: string) => void;
  onQuantityChange: (idx: number, quantity: number) => void;
  onCategoryChange: (idx: number, category: string | null) => void;
  onRequestCompleted: (rowId: string, requestId: string, targetType: string) => void;
}

const ShipmentTableRow: React.FC<ShipmentTableRowProps> = ({
  row, idx, boxCell, sizeError, isChecked, completed, customsOptions, doneBy,
  onToggleCheck, onQuantityChange, onCategoryChange, onRequestCompleted,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<'qty' | 'category' | null>(null);
  const [draft, setDraft] = useState('');

  const isManual = !!row.manual_item_id;
  const chinaOptions = [row.china_option1, row.china_option2].filter(Boolean).join(', ');
  const productInfo = [row.item_name, row.option_name].filter(Boolean).join(', ');
  const isMismatch = row.total_qty !== row.available_qty;

  // ── 인라인 편집 ──
  const startEdit = (kind: 'qty' | 'category') => {
    if (isManual) return;
    setDraft(kind === 'qty' ? String(row.quantity) : (row.customs_category || ''));
    setEditing(kind);
  };
  const commitEdit = () => {
    if (editing === 'qty') {
      const n = parseInt(draft, 10);
      if (!Number.isNaN(n) && n !== row.quantity) onQuantityChange(idx, n);
    }
    setEditing(null);
  };

  // ── 품목: 드롭다운에서 고르면 바로 반영 ──
  const currentCategory = (row.customs_category || '').trim();
  const currentInOptions = !currentCategory || customsOptions.some((o) => o.ko === currentCategory);
  const pickCategory = (value: string) => {
    if (value !== currentCategory) onCategoryChange(idx, value || null);
    setEditing(null);
  };
  const editKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') setEditing(null);
  };

  const rowClass = [
    'sv2-row',
    isChecked ? 'is-checked' : '',
    isMismatch ? 'is-mismatch' : '',
    row.move_request ? 'has-request' : '',
  ].filter(Boolean).join(' ');

  return (
    <tr className={rowClass}>
      {boxCell}

      {/* ── 체크박스 ── */}
      <td className="sv2-cell-check">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleCheck(row.id)}
          aria-label={`${t('shipmentV2.boxGroup.selectRow')} ${row.product_no || ''}`}
        />
      </td>

      {/* ── 주문번호 (클릭 → 체크) ── */}
      <td className="sv2-cell-order" onClick={() => onToggleCheck(row.id)}>
        <span className="sv2-order-no">
          {row.product_no || '-'}
          {isManual && <span className="sv2-manual-tag">MANUAL</span>}
        </span>
      </td>

      <td className="sv2-cell-mono">{row.barcode || '-'}</td>

      {/* ── 상품정보 + 이동요청 ── */}
      <td className="sv2-cell-product">
        <div className="sv2-product">
          <span className="sv2-product-text">{productInfo || '-'}</span>
          <MoveRequestButton
            request={row.move_request}
            completed={completed}
            doneBy={doneBy}
            onCompleted={(requestId, targetType) => onRequestCompleted(row.id, requestId, targetType)}
          />
        </div>
      </td>

      <td className="sv2-cell-option">{chinaOptions || '-'}</td>

      {/* ── 단가 ── */}
      <td className="sv2-cell-num sv2-cell-price">{row.price_cny ?? '-'}</td>

      {/* ── 품목: 영문 / ? 표시, 클릭 → 한글 편집 ── */}
      <td
        className={`sv2-cell-center ${isManual ? '' : 'sv2-editable'}`}
        onClick={() => editing !== 'category' && startEdit('category')}
        title={isManual ? undefined : t('shipmentV2.category.editHint')}
      >
        {editing === 'category' ? (
          <select
            className="sv2-inline-select"
            value={currentCategory}
            autoFocus
            onChange={(e) => pickCategory(e.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">-</option>
            {!currentInOptions && <option value={currentCategory}>{currentCategory}</option>}
            {customsOptions.map((o) => (
              <option key={o.ko} value={o.ko}>{o.en}</option>
            ))}
          </select>
        ) : (
          <CategoryLabel raw={row.customs_category} en={row.customs_category_en} emptyText="-" />
        )}
      </td>

      {/* ── 사이즈 — 박스 타입과 다르면 빨간 테두리 깜빡임 ── */}
      <td className="sv2-cell-center">
        {row.size_code ? (
          <span
            className={`sv2-size-badge sv2-tone--${row.size_code.toLowerCase()} ${sizeError ? 'is-error' : ''}`}
            title={sizeError ? t('shipmentV2.summary.shipmentErrorHint') : undefined}
          >
            {row.size_code}
          </span>
        ) : '-'}
      </td>

      {/* ── 입고 ── */}
      <td className="sv2-cell-num">{row.available_qty}</td>

      {/* ── 스캔 (클릭 편집 — 화면 값만) ── */}
      <td
        className={`sv2-cell-num sv2-cell-scan ${isManual ? '' : 'sv2-editable'}`}
        onClick={() => editing !== 'qty' && startEdit('qty')}
      >
        {editing === 'qty' ? (
          <input
            className="sv2-inline-input sv2-inline-input--num"
            value={draft}
            inputMode="numeric"
            autoFocus
            onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
            onBlur={commitEdit}
            onKeyDown={editKeyDown}
          />
        ) : row.quantity}
      </td>

      {/* ── 전체 (같은 상품의 미출고 포장 합) ── */}
      <td className="sv2-cell-num">{row.total_qty}</td>
    </tr>
  );
};

export default ShipmentTableRow;
