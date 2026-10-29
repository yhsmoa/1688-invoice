'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipmentV2Row } from '../types';
import { getBadgeClass, getBoxType, type ShipmentSizeCode } from '../utils/shipmentCodes';
import BoxSizeEditor from './BoxSizeEditor';
import CategoryLabel from './CategoryLabel';
import MoveRequestButton, { type CompletedRequest } from './MoveRequestButton';

// ============================================================
// ShipmentTableRow — 쉽먼트 V2 표의 한 행 (포장 행 1건)
//
//   박스번호(rowSpan 첫 행만) | ☐ | 주문번호 | 바코드 | 상품정보 + 이동요청 | 주문옵션 |
//   단가 | 품목(영문/❓, 클릭 편집=한글) | 쉽먼트사이즈 | 입고 | 스캔(클릭 편집) | 전체
//
//   · 품목 편집값은 부모가 dirty 로 모아 [저장] 때 일괄 PATCH (기존 동작 유지)
//   · 스캔 편집은 화면 값만 바꾼다 (기존 동작 유지 — 저장 경로 없음)
//   · 부자재([생성]) 행은 품목·스캔 편집 불가 — order_item 이 없어 저장 대상이 아니다
// ============================================================
interface ShipmentTableRowProps {
  row: ShipmentV2Row;
  idx: number;
  /** box_code 그룹의 첫 행이면 rowSpan, 아니면 undefined */
  span: number | undefined;
  sizeError: ShipmentSizeCode | null;
  isChecked: boolean;
  completed: CompletedRequest | undefined;
  doneBy: string;
  onToggleCheck: (rowId: string) => void;
  onPackageClick: (boxCode: string) => void;
  onQuantityChange: (idx: number, quantity: number) => void;
  onCategoryChange: (idx: number, category: string | null) => void;
  onBoxSizeSaved: (boxInfoId: string, size: string | null) => void;
  onRequestCompleted: (rowId: string, requestId: string, targetType: string) => void;
}

const ShipmentTableRow: React.FC<ShipmentTableRowProps> = ({
  row, idx, span, sizeError, isChecked, completed, doneBy,
  onToggleCheck, onPackageClick, onQuantityChange, onCategoryChange, onBoxSizeSaved, onRequestCompleted,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<'qty' | 'category' | null>(null);
  const [draft, setDraft] = useState('');

  const isManual = !!row.manual_item_id;
  const boxType = getBoxType(row.box_code || '');
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
    } else if (editing === 'category') {
      const v = draft.trim();
      if (v !== (row.customs_category || '')) onCategoryChange(idx, v || null);
    }
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
      {/* ── 박스번호 + 사이즈: rowSpan 병합, 합배송 시 마스터 표시 ── */}
      {span !== undefined && (
        <td rowSpan={span} className="sv2-cell-box">
          <div className="sv2-box-stack">
            <button
              type="button"
              className={`shipment-v2-badge ${row.master_box_code ? 'shipment-v2-badge--gray' : getBadgeClass(boxType)}`}
              onClick={() => onPackageClick(row.box_code)}
            >
              {row.box_code}
            </button>
            <BoxSizeEditor boxInfoId={row.box_info_id} size={row.box_size} onSaved={onBoxSizeSaved} />
            {row.master_box_code && (
              <>
                <span className="sv2-merge-arrow" aria-hidden="true">↓</span>
                <span className={`shipment-v2-badge ${getBadgeClass(getBoxType(row.master_box_code))}`}>
                  {row.master_box_code}
                </span>
              </>
            )}
          </div>
        </td>
      )}

      {/* ── 체크박스 ── */}
      <td className="sv2-cell-center">
        <input type="checkbox" checked={isChecked} onChange={() => onToggleCheck(row.id)} />
      </td>

      {/* ── 주문번호 (클릭 → 체크) ── */}
      <td className="sv2-cell-order" onClick={() => onToggleCheck(row.id)}>
        {row.product_no || '-'}
        {isManual && <span className="sv2-manual-tag">MANUAL</span>}
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
      <td className="sv2-cell-num">{row.price_cny ?? '-'}</td>

      {/* ── 품목: 영문 / ❓ 표시, 클릭 → 한글 편집 ── */}
      <td
        className={`sv2-cell-center ${isManual ? '' : 'sv2-editable'}`}
        onClick={() => editing !== 'category' && startEdit('category')}
        title={isManual ? undefined : t('shipmentV2.category.editHint')}
      >
        {editing === 'category' ? (
          <input
            className="sv2-inline-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={editKeyDown}
          />
        ) : (
          <CategoryLabel raw={row.customs_category} en={row.customs_category_en} emptyText="-" />
        )}
      </td>

      {/* ── 쉽먼트사이즈 — 박스와 안 맞으면 빨간 깜빡임 ── */}
      <td className="sv2-cell-center">
        {row.size_code ? (
          <span
            className={`shipment-v2-badge shipment-v2-badge--sm ${getBadgeClass(row.size_code)} ${sizeError ? 'shipment-v2-badge--error-blink' : ''}`}
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
        className={`sv2-cell-num ${isManual ? '' : 'sv2-editable'}`}
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
