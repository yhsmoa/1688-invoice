'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShipmentV2Row } from '../types';
import type { ShipmentSizeCode } from '../utils/shipmentCodes';
import type { CompletedRequest } from './MoveRequestButton';
import ShipmentTableRow from './ShipmentTableRow';

// ============================================================
// ShipmentTable — 쉽먼트 V2 표
//   · visibleIndices 는 원본 rows 의 인덱스 (편집은 원본 idx, 체크는 행 id 기준)
//   · 박스번호 셀은 보이는 행 기준으로 같은 box_code 가 이어지면 rowSpan 병합
// ============================================================
const TOTAL_COLS = 12;

interface ShipmentTableProps {
  rows: ShipmentV2Row[];
  visibleIndices: number[];
  rowErrors: (ShipmentSizeCode | null)[];
  checkedIds: Set<string>;
  completedRequests: Map<string, CompletedRequest>;
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

const ShipmentTable: React.FC<ShipmentTableProps> = (props) => {
  const { rows, visibleIndices, rowErrors, checkedIds, completedRequests, loading, loadError, hasUser } = props;
  const { t } = useTranslation();

  // ── box_code 기준 rowSpan (보이는 행 기준, key 는 원본 idx) ──
  const rowSpanMap = useMemo(() => {
    const map = new Map<number, number>();
    let groupStart = -1;
    let prev: string | null = null;
    for (const i of visibleIndices) {
      const pkg = rows[i].box_code || '';
      if (pkg !== prev) {
        groupStart = i;
        map.set(i, 1);
        prev = pkg;
      } else {
        map.set(groupStart, (map.get(groupStart) ?? 0) + 1);
      }
    }
    return map;
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
    <div className="sv2-table-wrap">
      <table className="sv2-table">
        <thead>
          <tr>
            <th className="sv2-th-center">{t('shipmentV2.table.box')}</th>
            <th className="sv2-th-center sv2-th-check">
              <input type="checkbox" checked={allVisibleChecked} onChange={props.onToggleAll} />
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
        <tbody>
          {emptyMessage !== null ? (
            <tr><td colSpan={TOTAL_COLS} className="sv2-empty">{emptyMessage}</td></tr>
          ) : (
            visibleIndices.map((idx) => {
              const row = rows[idx];
              return (
                <ShipmentTableRow
                  key={row.id}
                  row={row}
                  idx={idx}
                  span={rowSpanMap.get(idx)}
                  sizeError={rowErrors[idx]}
                  isChecked={checkedIds.has(row.id)}
                  completed={completedRequests.get(row.id)}
                  doneBy={props.doneBy}
                  onToggleCheck={props.onToggleCheck}
                  onPackageClick={props.onPackageClick}
                  onQuantityChange={props.onQuantityChange}
                  onCategoryChange={props.onCategoryChange}
                  onBoxSizeSaved={props.onBoxSizeSaved}
                  onRequestCompleted={props.onRequestCompleted}
                />
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ShipmentTable;
