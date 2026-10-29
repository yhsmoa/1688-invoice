'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipmentV2Row } from '../types';
import { getBoxType, type ShipmentSizeCode } from '../utils/shipmentCodes';
import type { CustomsOption } from '../hooks/useCustomsOptions';
import BoxSizeEditor from './BoxSizeEditor';
import type { CompletedRequest } from './MoveRequestButton';
import ShipmentTableRow from './ShipmentTableRow';

// ============================================================
// ShipmentTable — 쉽먼트 V2 표 (박스별 묶음)
//
//   박스 칸(rowSpan) | ☐ | 주문번호 | 바코드 | 상품정보 + 이동요청 | 주문옵션 | 단가 | 품목 | 사이즈 | 입고 | 스캔 | 전체
//   박스 칸 = 박스코드(클릭 → 그 박스 행 전체 선택) / 사이즈(클릭 → 수정) / n행 · 스캔 m개 / 합배송 대상
//
//   · visibleIndices 는 원본 rows 의 인덱스 (편집은 원본 idx, 체크는 행 id 기준)
//   · 묶음 = 보이는 행 기준으로 같은 box_code 가 이어지는 구간 (rows 는 box_code 정렬)
//   · 표는 따로 스크롤하지 않고 페이지와 함께 스크롤. 머리줄은 상단 메뉴 바로 아래에 붙는다
//     (상단 메뉴 높이를 실제로 재서 CSS 변수로 넘긴다 — 메뉴 높이가 바뀌어도 맞음)
// ============================================================
const TOTAL_COLS = 12;
const TOP_MENU_SELECTOR = '.topside-menu';

interface ShipmentTableProps {
  rows: ShipmentV2Row[];
  visibleIndices: number[];
  rowErrors: (ShipmentSizeCode | null)[];
  checkedIds: Set<string>;
  completedRequests: Map<string, CompletedRequest>;
  customsOptions: CustomsOption[];
  doneBy: string;
  loading: boolean;
  loadError: boolean;
  hasUser: boolean;
  onToggleCheck: (rowId: string) => void;
  onToggleAll: () => void;
  onPackageClick: (boxCode: string) => void;
  onQuantityChange: (idx: number, quantity: number) => void;
  onCategoryChange: (idx: number, category: string | null) => void;
  onBoxSizeSaved: (boxInfoId: string, size: string | null) => void;
  onRequestCompleted: (rowId: string, requestId: string, targetType: string) => void;
}

interface BoxGroup {
  boxCode: string;
  indices: number[];
}

/** 상단 메뉴(sticky) 높이 — 표 머리줄이 그 아래에 붙도록 */
function useTopMenuHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(TOP_MENU_SELECTOR);
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return height;
}

const ShipmentTable: React.FC<ShipmentTableProps> = (props) => {
  const { rows, visibleIndices, rowErrors, checkedIds, completedRequests, loading, loadError, hasUser } = props;
  const { t } = useTranslation();
  const topOffset = useTopMenuHeight();

  // ── 보이는 행 → 박스 묶음 ──
  const groups = useMemo(() => {
    const result: BoxGroup[] = [];
    for (const i of visibleIndices) {
      const code = rows[i].box_code || '';
      const last = result[result.length - 1];
      if (last && last.boxCode === code) last.indices.push(i);
      else result.push({ boxCode: code, indices: [i] });
    }
    return result;
  }, [rows, visibleIndices]);

  const allVisibleChecked =
    visibleIndices.length > 0 && visibleIndices.every((i) => checkedIds.has(rows[i].id));

  // ── 빈 상태 문구 ──
  const emptyMessage = loading
    ? t('shipmentV2.empty.loading')
    : !hasUser
      ? t('shipmentV2.empty.selectUser')
      : loadError
        ? t('shipmentV2.empty.loadError')
        : rows.length === 0
          ? t('shipmentV2.empty.noData')
          : visibleIndices.length === 0
            ? t('shipmentV2.empty.noFilterMatch')
            : null;

  return (
    <div className="sv2-table-wrap" style={{ ['--sv2-sticky-top' as string]: `${topOffset}px` }}>
      <table className="sv2-table">
        <thead>
          <tr>
            <th className="sv2-th-box">{t('shipmentV2.table.box')}</th>
            <th className="sv2-th-check">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={props.onToggleAll}
                aria-label={t('shipmentV2.boxGroup.selectAll')}
              />
            </th>
            <th>{t('shipmentV2.table.order')}</th>
            <th>{t('shipmentV2.table.barcode')}</th>
            <th className="sv2-th-product">{t('shipmentV2.table.product')}</th>
            <th>{t('shipmentV2.table.options')}</th>
            <th className="sv2-th-num">{t('shipmentV2.table.price')}</th>
            <th className="sv2-th-center">{t('shipmentV2.table.category')}</th>
            <th className="sv2-th-center">{t('shipmentV2.table.shipmentSize')}</th>
            <th className="sv2-th-num">{t('shipmentV2.table.arrival')}</th>
            <th className="sv2-th-num">{t('shipmentV2.table.scan')}</th>
            <th className="sv2-th-num">{t('shipmentV2.table.total')}</th>
          </tr>
        </thead>

        {emptyMessage !== null ? (
          <tbody>
            <tr><td colSpan={TOTAL_COLS} className="sv2-empty">{emptyMessage}</td></tr>
          </tbody>
        ) : (
          groups.map((group, gi) => {
            const first = rows[group.indices[0]];
            const boxType = getBoxType(group.boxCode).toLowerCase();
            const merged = !!first.master_box_code;
            const groupIds = group.indices.map((i) => rows[i].id);
            const allChecked = groupIds.every((id) => checkedIds.has(id));
            const scanQty = group.indices.reduce((sum, i) => sum + (rows[i].quantity || 0), 0);
            // ── 박스 칸 (묶음 첫 행에 rowSpan) ──
            const boxCell = (
              <td rowSpan={group.indices.length} className="sv2-cell-box">
                <div className="sv2-box-stack">
                  <button
                    type="button"
                    className={`sv2-box-badge ${merged ? 'sv2-tone--merged' : `sv2-tone--${boxType || 'none'}`} ${allChecked ? 'is-selected' : ''}`}
                    onClick={() => props.onPackageClick(group.boxCode)}
                    aria-pressed={allChecked}
                    title={t('shipmentV2.boxGroup.selectBox')}
                  >
                    {group.boxCode || '-'}
                  </button>
                  <BoxSizeEditor boxInfoId={first.box_info_id} size={first.box_size} onSaved={props.onBoxSizeSaved} />
                  <span className="sv2-box-meta">
                    {t('shipmentV2.boxGroup.meta', { rows: group.indices.length, qty: scanQty })}
                  </span>
                  {merged && (
                    <span className="sv2-box-merge">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14M6 13l6 6 6-6" />
                      </svg>
                      {t('shipmentV2.boxGroup.merged')} <strong>{first.master_box_code}</strong>
                    </span>
                  )}
                </div>
              </td>
            );
            return (
              <tbody key={`${group.boxCode}-${gi}`} className="sv2-group">
                {group.indices.map((idx, ri) => {
                  const row = rows[idx];
                  return (
                    <ShipmentTableRow
                      key={row.id}
                      row={row}
                      idx={idx}
                      boxCell={ri === 0 ? boxCell : null}
                      sizeError={rowErrors[idx]}
                      isChecked={checkedIds.has(row.id)}
                      completed={completedRequests.get(row.id)}
                      customsOptions={props.customsOptions}
                      doneBy={props.doneBy}
                      onToggleCheck={props.onToggleCheck}
                      onQuantityChange={props.onQuantityChange}
                      onCategoryChange={props.onCategoryChange}
                      onRequestCompleted={props.onRequestCompleted}
                    />
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

export default ShipmentTable;
