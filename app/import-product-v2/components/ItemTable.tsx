'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import ItemTableRow from './ItemTableRow';
import type { FtOrderItem } from '../hooks/useFtData';

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
  /** item_id → PACKED quantity 합계 */
  packedMap: Map<string, number>;
  /** item_id → CANCEL quantity 합계 */
  cancelMap: Map<string, number>;
  /** item_id → SHIPMENT quantity 합계 */
  shipmentMap: Map<string, number>;
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
  shipmentMap,
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
            paginatedData.map((item, idx) => (
              <ItemTableRow
                key={item.id}
                item={item}
                sameGroupAsNext={
                  idx < paginatedData.length - 1
                  && !!item.product_id
                  && item.product_id === paginatedData[idx + 1].product_id
                }
                isSelected={selectedRows.has(item.id)}
                mousePosition={mousePosition}
                editingCell={editingCell}
                cellValue={cellValue}
                importQtyValue={modifiedImportQty.get(item.id)}
                arrivalQty={arrivalMap.get(item.id) ?? 0}
                packedQty={packedMap.get(item.id) ?? 0}
                cancelQty={cancelMap.get(item.id) ?? 0}
                shipmentQty={shipmentMap.get(item.id) ?? 0}
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ItemTable;
