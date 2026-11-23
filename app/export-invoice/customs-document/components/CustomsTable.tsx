'use client';

import React from 'react';
import { useTopMenuHeight } from '../../../shipment-v2/hooks/useTopMenuHeight';
import { getBoxType, SHIPMENT_SIZE_CODES } from '../../../shipment-v2/utils/shipmentCodes';
import type { CustomsDocumentData } from '../types';

// ============================================================
// CustomsTable — 통관서류 작성 표 (상자별 묶음, 쉽먼트 V2 표와 같은 모양)
//
//   상자 칸(rowSpan) | ☐ | 이미지 | 주문번호 · 바코드 | 상품명 | 옵션명 | 단가 | 품목 | 혼용률 | 출고 | 입고
//   상자 칸 = 상자 코드(클릭 → 그 상자 행 전체 선택) / 상자 사이즈 / n건 / [이동] (상품별 보기만)
//
//   · 스타일은 쉽먼트 V2 의 sv2-* 를 그대로 쓴다 (app/shipment-v2/ShipmentV2.css)
//   · 값 칸을 누르면 그 값이 복사된다 (기존 동작 유지)
//   · 표는 따로 스크롤하지 않고 페이지와 함께 스크롤. 머리줄은 상단 메뉴 바로 아래에 붙는다
// ============================================================
const TOTAL_COLS = 11;

export type CustomsViewMode = '상품별' | '품목별';

/** 상자(위치) 하나 — items 는 원본 행, rows 는 보기 방식에 따라 화면에 그릴 행 */
export interface CustomsBoxGroup {
  location: string;
  items: CustomsDocumentData[];
  rows: CustomsDocumentData[];
}

interface CustomsTableProps {
  groups: CustomsBoxGroup[];
  viewMode: CustomsViewMode;
  selectedRows: Set<string>;
  /** 표 대신 보여 줄 문구 (없으면 null) */
  emptyMessage: string | null;
  onToggleRow: (id: string, checked: boolean) => void;
  onToggleLocation: (location: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onMoveClick: (location: string) => void;
  onCopy: (text: string) => void;
}

/** 상자 코드 → 배지 색 (A·B·C 파랑 / P 주황 / X 검정 / 그 밖 회색) */
const boxToneClass = (location: string): string => {
  const type = getBoxType(location);
  return (SHIPMENT_SIZE_CODES as readonly string[]).includes(type)
    ? `sv2-tone--${type.toLowerCase()}`
    : 'sv2-tone--none';
};

const CustomsTable: React.FC<CustomsTableProps> = ({
  groups, viewMode, selectedRows, emptyMessage,
  onToggleRow, onToggleLocation, onToggleAll, onMoveClick, onCopy,
}) => {
  const topOffset = useTopMenuHeight();

  const allChecked =
    groups.length > 0 && groups.every((g) => g.rows.every((row) => selectedRows.has(row.id)));

  /** 누르면 복사되는 값 칸 */
  const copyCell = (value: string | undefined, className = '') => (
    <td
      className={`cd-copy ${className}`.trim()}
      onClick={() => onCopy(value || '')}
      title="클릭하여 복사"
    >
      {value || ''}
    </td>
  );

  return (
    <div className="sv2-table-wrap" style={{ ['--sv2-sticky-top' as string]: `${topOffset}px` }}>
      <table className="sv2-table">
        <thead>
          <tr>
            <th className="sv2-th-box">상자</th>
            <th className="sv2-th-check">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleAll(e.target.checked)}
                aria-label="전체 선택"
              />
            </th>
            <th className="sv2-th-center cd-th-image">이미지</th>
            <th>주문번호 · 바코드</th>
            <th className="sv2-th-product">상품명</th>
            <th>옵션명</th>
            <th className="sv2-th-num">단가</th>
            <th className="sv2-th-center">품목</th>
            <th>혼용률</th>
            <th className="sv2-th-num">출고</th>
            <th className="sv2-th-num">입고</th>
          </tr>
        </thead>

        {emptyMessage !== null ? (
          <tbody>
            <tr><td colSpan={TOTAL_COLS} className="sv2-empty">{emptyMessage}</td></tr>
          </tbody>
        ) : (
          groups.map((group) => {
            const boxSize = group.items.find((item) => item.box_size)?.box_size;
            const boxChecked = group.rows.every((row) => selectedRows.has(row.id));
            // ── 상자 칸 (묶음 첫 행에 rowSpan) ──
            const boxCell = (
              <td rowSpan={group.rows.length} className="sv2-cell-box">
                <div className="sv2-box-stack">
                  <button
                    type="button"
                    className={`sv2-box-badge ${boxToneClass(group.location)} ${boxChecked ? 'is-selected' : ''}`}
                    onClick={() => onToggleLocation(group.location, !boxChecked)}
                    aria-pressed={boxChecked}
                    title="이 상자의 행 전체 선택"
                  >
                    {group.location}
                  </button>
                  {boxSize && <span className="sv2-box-size">{boxSize}</span>}
                  <span className="sv2-box-meta">
                    {viewMode === '품목별' ? `${group.rows.length}개 품목` : `${group.items.length}건`}
                  </span>
                  {viewMode === '상품별' && (
                    <button
                      type="button"
                      className="sv2-btn sv2-btn--solo sv2-btn--sm"
                      onClick={() => onMoveClick(group.location)}
                    >
                      이동
                    </button>
                  )}
                </div>
              </td>
            );

            return (
              <tbody key={group.location} className="sv2-group">
                {group.rows.map((item, ri) => {
                  const isChecked = selectedRows.has(item.id);
                  return (
                    <tr key={item.id} className={`sv2-row ${isChecked ? 'is-checked' : ''}`}>
                      {ri === 0 ? boxCell : null}

                      {/* ── 체크박스 ── */}
                      <td className="sv2-cell-check">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => onToggleRow(item.id, e.target.checked)}
                          aria-label={`행 선택 ${item.order_number || ''}`}
                        />
                      </td>

                      {/* ── 이미지 ── */}
                      <td className="cd-cell-image">
                        {item.image && (
                          <img
                            src={`/api/image-proxy?url=${encodeURIComponent(item.image)}`}
                            alt="상품 이미지"
                            className="cd-thumb"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/placeholder.svg';
                            }}
                          />
                        )}
                      </td>

                      {/* ── 주문번호 · 바코드 (누르면 두 줄로 복사) ── */}
                      <td
                        className="cd-copy cd-cell-order"
                        onClick={() => onCopy(`${item.order_number || ''}\n${item.barcode || ''}`)}
                        title="클릭하여 복사"
                      >
                        <div className="cd-order-no">{item.order_number || ''}</div>
                        <div className="cd-barcode">{item.barcode || ''}</div>
                      </td>

                      {copyCell(item.product_name, 'sv2-product-text')}
                      {copyCell(item.option_name, 'sv2-cell-option')}
                      {copyCell(item.unit_price, 'sv2-cell-num sv2-cell-price')}
                      {copyCell(item.item_category, 'sv2-cell-center')}
                      {copyCell(item.blend_ratio, 'sv2-cell-option')}
                      {copyCell(item.out_quantity, 'sv2-cell-num sv2-cell-scan')}
                      {copyCell(item.in_quantity, 'sv2-cell-num')}
                    </tr>
                  );
                })}
              </tbody>
            );
          })
        )}
      </table>
    </div>
  );
};

export default CustomsTable;
