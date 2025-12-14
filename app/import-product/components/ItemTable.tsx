'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import ItemTableRow from './ItemTableRow';
import type { ItemData } from '../hooks';

interface ItemTableProps {
  loading: boolean;
  paginatedData: ItemData[];
  selectedRows: Set<string>;
  editingCell: {id: string, field: string} | null;
  cellValue: string;
  mousePosition: { x: number, y: number };
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onSelectAll: (checked: boolean) => void;
  onSelectRow: (id: string, checked: boolean) => void;
  onStartEditingCell: (id: string, field: string, value: number | string | null | undefined) => void;
  onCellValueChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onHandleCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFinishEditingCell: (moveToNext: boolean) => void;
  onSetCellValue: (value: string) => void;
  onCostClick: (e: React.MouseEvent, item: ItemData) => void;
}

const ItemTable: React.FC<ItemTableProps> = ({
  loading,
  paginatedData,
  selectedRows,
  editingCell,
  cellValue,
  mousePosition,
  isAllSelected,
  isIndeterminate,
  onSelectAll,
  onSelectRow,
  onStartEditingCell,
  onCellValueChange,
  onHandleCellKeyDown,
  onFinishEditingCell,
  onSetCellValue,
  onCostClick
}) => {
  const { t } = useTranslation();

  return (
    <div className="table-board">
      <table className="item-table">
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
                className="table-checkbox"
              />
            </th>
            <th>{t('importProduct.table.image')}</th>
            <th>{t('importProduct.table.orderNumber')}</th>
            <th>{t('importProduct.table.productName')}</th>
            <th>{t('importProduct.table.orderOption')}</th>
            <th>{t('importProduct.table.quantity')}</th>
            <th>{t('importProduct.table.cost')}</th>
            <th>{t('importProduct.table.progress')}</th>
            <th>{t('importProduct.table.import')}</th>
            <th>{t('importProduct.table.cancel')}</th>
            <th>{t('importProduct.table.export')}</th>
            <th>{t('importProduct.table.note')}</th>
            <th>{t('importProduct.table.info')}</th>
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
            paginatedData.map((item) => (
              <ItemTableRow
                key={item.id}
                item={item}
                isSelected={selectedRows.has(item.id)}
                editingCell={editingCell}
                cellValue={cellValue}
                mousePosition={mousePosition}
                onSelectRow={onSelectRow}
                onStartEditingCell={onStartEditingCell}
                onCellValueChange={onCellValueChange}
                onHandleCellKeyDown={onHandleCellKeyDown}
                onFinishEditingCell={onFinishEditingCell}
                onSetCellValue={onSetCellValue}
                onCostClick={onCostClick}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export default ItemTable;
