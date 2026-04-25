'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ItemTableRow from './ItemTableRow';
import type { FtOrderItem } from '../hooks/useFtData';
import { getSetGroupKey } from '../utils/setGroupPalette';

/* V2 전용 ItemTable 컴포넌트 - 원래 13열 헤더 유지 */

interface ItemTableProps {
  loading: boolean;
  paginatedData: FtOrderItem[];
  selectedRows: Set<string>;
  mousePosition: { x: number; y: number };
  isAllSelected: boolean;
  isIndeterminate: boolean;
  editingCell: { id: string; field: string } | null;
  cellValue: string;
  modifiedImportQty: Map<string, number>;
  /** item_id → ARRIVAL quantity 합계 */
  arrivalMap: Map<string, number>;
  /** item_id → PACKED quantity 합계 (전체) */
  packedMap: Map<string, number>;
  /** item_id → CANCEL quantity 합계 (raw — 단순 접수 포함) */
  cancelMap: Map<string, number>;
  /** item_id → RETURN quantity 합계 (raw — 단순 접수 포함) */
  returnMap: Map<string, number>;
  /** item_id → SHIPMENT quantity 합계 */
  shipmentMap: Map<string, number>;
  /** product_id → 출고(PACKED + shipment_id NOT NULL) quantity 합계 */
  exportMap: Map<string, number>;
  /** item_id → 출고완료PACKED(shipment_id NOT NULL) quantity 합계 — 진행 공식용 */
  shippedItemMap: Map<string, number>;
  /** Storage 에 PDF 가 존재하는 personal_order_no Set — P 배지 '운송장 출력' 조건부 표시용 */
  invoicePdfSet: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  onStartEditingCell: (id: string, field: string, value: number | string | null | undefined) => void;
  onCellValueChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFinishEditingCell: () => void;
  onProductNameClick: (item: FtOrderItem) => void;
  categoryEditing: { id: string } | null;
  categoryValue: string;
  onStartCategoryEdit: (id: string, currentValue: string | null) => void;
  onCategoryValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCategoryKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFinishCategoryEdit: () => void;
}

const ItemTable: React.FC<ItemTableProps> = ({
  loading,
  paginatedData,
  selectedRows,
  mousePosition,
  isAllSelected,
  isIndeterminate,
  editingCell,
  cellValue,
  modifiedImportQty,
  arrivalMap,
  packedMap,
  cancelMap,
  returnMap,
  shipmentMap,
  exportMap,
  shippedItemMap,
  invoicePdfSet,
  onSelectAll,
  onSelectRow,
  onStartEditingCell,
  onCellValueChange,
  onCellKeyDown,
  onFinishEditingCell,
  onProductNameClick,
  categoryEditing,
  categoryValue,
  onStartCategoryEdit,
  onCategoryValueChange,
  onCategoryKeyDown,
  onFinishCategoryEdit,
}) => {
  const { t } = useTranslation();

  // ============================================================
  // 세트 그룹 판정 — 단일 키 함수(getSetGroupKey) 기반
  //
  //   1. 각 행의 set group key 사전 계산 (rowKeys)
  //   2. 고유 key에 색상 인덱스 부여 (setGroupColorIndex)
  //
  // 행별 용도:
  //   - 색상 인덱스: setGroupColorIndex.get(rowKeys[idx])
  //   - 가로 border 제거: rowKeys[idx] !== null && rowKeys[idx] === rowKeys[idx+1]
  // ============================================================
  const { rowKeys, setGroupColorIndex } = useMemo(() => {
    const rowKeys: (string | null)[] = paginatedData.map(getSetGroupKey);
    const colorMap = new Map<string, number>();
    let counter = 0;
    for (const key of rowKeys) {
      if (key !== null && !colorMap.has(key)) {
        colorMap.set(key, counter++);
      }
    }
    return { rowKeys, setGroupColorIndex: colorMap };
  }, [paginatedData]);

  return (
    <div className="v2-table-board">
      <table className="v2-item-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={isAllSelected}
                ref={(input) => {
                  if (input) input.indeterminate = isIndeterminate;
                }}
                onChange={(e) => onSelectAll(e.target.checked)}
                className="v2-table-checkbox"
              />
            </th>
            <th>{t('importProduct.table.image')}</th>
            <th>{t('importProduct.table.orderNumber')}</th>
            <th>{t('importProduct.table.productName')}</th>
            <th>{t('importProduct.table.orderOption')}</th>
            <th>{t('importProduct.table.quantity')}</th>
            <th>{t('importProduct.table.cost')}</th>
            <th>{t('importProduct.table.progress')}</th>
            <th className="v2-work-cell">작업</th>
            <th>입고</th>
            <th>포장</th>
            <th>{t('importProduct.table.cancel')}</th>
            <th>{t('importProduct.table.export')}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={13} className="empty-data">{t('importProduct.table.loading')}</td>
            </tr>
          ) : paginatedData.length === 0 ? (
            <tr>
              <td colSpan={13} className="empty-data">{t('importProduct.table.noData')}</td>
            </tr>
          ) : (
            paginatedData.map((item, idx) => {
              const thisKey = rowKeys[idx];
              const nextKey = idx < paginatedData.length - 1 ? rowKeys[idx + 1] : null;
              // 가로 border 제거: 세트 그룹 내 인접 행일 때만 (thisKey != null 보장)
              const sameGroupAsNext = thisKey !== null && thisKey === nextKey;
              const setColorIdx = thisKey !== null ? setGroupColorIndex.get(thisKey) : undefined;
              return (
              <ItemTableRow
                key={item.id}
                item={item}
                sameGroupAsNext={sameGroupAsNext}
                setColorIndex={setColorIdx}
                isSelected={selectedRows.has(item.id)}
                mousePosition={mousePosition}
                editingCell={editingCell}
                cellValue={cellValue}
                importQtyValue={modifiedImportQty.get(item.id)}
                arrivalQty={arrivalMap.get(item.id) ?? 0}
                packedQty={packedMap.get(item.id) ?? 0}
                cancelQty={cancelMap.get(item.id) ?? 0}
                returnQty={returnMap.get(item.id) ?? 0}
                shippedItemQty={shippedItemMap.get(item.id) ?? 0}
                shipmentQty={exportMap.get(item.product_id ?? '') ?? 0}
                hasInvoicePdf={
                  !!item.personal_order_no && invoicePdfSet.has(item.personal_order_no)
                }
                onSelectRow={onSelectRow}
                onStartEditingCell={onStartEditingCell}
                onCellValueChange={onCellValueChange}
                onCellKeyDown={onCellKeyDown}
                onFinishEditingCell={onFinishEditingCell}
                onProductNameClick={onProductNameClick}
                categoryEditing={categoryEditing}
                categoryValue={categoryValue}
                onStartCategoryEdit={onStartCategoryEdit}
                onCategoryValueChange={onCategoryValueChange}
                onCategoryKeyDown={onCategoryKeyDown}
                onFinishCategoryEdit={onFinishCategoryEdit}
              />
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ItemTable;
