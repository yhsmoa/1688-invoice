'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import EditableCell from './EditableCell';
import type { ItemData } from '../hooks';

interface ItemTableRowProps {
  item: ItemData;
  isSelected: boolean;
  editingCell: {id: string, field: string} | null;
  cellValue: string;
  mousePosition: { x: number, y: number };
  onSelectRow: (id: string, checked: boolean) => void;
  onStartEditingCell: (id: string, field: string, value: number | string | null | undefined) => void;
  onCellValueChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onHandleCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFinishEditingCell: (moveToNext: boolean) => void;
  onSetCellValue: (value: string) => void;
  onCostClick: (e: React.MouseEvent, item: ItemData) => void;
}

const ItemTableRow: React.FC<ItemTableRowProps> = ({
  item,
  isSelected,
  editingCell,
  cellValue,
  mousePosition,
  onSelectRow,
  onStartEditingCell,
  onCellValueChange,
  onHandleCellKeyDown,
  onFinishEditingCell,
  onSetCellValue,
  onCostClick
}) => {
  const { t } = useTranslation();

  // 행 배경색 결정: 진행 > 입고인 경우만 노란색
  const progressQty = parseInt(item.progress_qty?.toString() || '0');
  const importQty = parseInt(item.import_qty?.toString() || '0');
  const isMissingDelivery = progressQty > importQty;

  return (
    <tr key={item.id} className={isMissingDelivery ? 'missing-delivery-row' : ''}>
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelectRow(item.id, e.target.checked)}
          className="table-checkbox"
        />
      </td>
      <td>
        {item.img_url ? (
          <div className="image-preview-container">
            <img
              src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
              alt="상품 이미지"
              className="product-thumbnail"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
            <div
              className="image-preview"
              style={{
                top: `${mousePosition.y - 300}px`,
                left: `${mousePosition.x + 30}px`
              }}
            >
              <img
                src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                alt="상품 이미지 미리보기"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/placeholder.svg';
                }}
              />
            </div>
          </div>
        ) : (
          <div className="no-image">{t('importProduct.table.noImage')}</div>
        )}
      </td>
      <td>
        <div className="order-number-text">
          {item.order_number_prefix || ''}
          {item.order_number_prefix && item.order_number && <br />}
          {item.order_number || ''}
          {/* SET 상품 표시: 주문번호 4번째 부분이 S로 시작하면 세트 상품 */}
          {(() => {
            const orderNum = item.order_number || '';
            const parts = orderNum.split('-');
            // 4번째 부분이 S로 시작하는지 확인 (예: BZ-260120-0088-S21)
            if (parts.length >= 4 && parts[3].startsWith('S')) {
              const setCode = parts[3].substring(1); // "S21" → "21"
              if (setCode.length >= 2) {
                const totalCount = setCode[0]; // 첫번째 숫자: 총 세트 개수
                const currentNum = setCode[1]; // 두번째 숫자: 현재 아이템 번호
                return (
                  <div style={{ marginTop: '4px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span
                        style={{
                          backgroundColor: '#FFD700',
                          color: '#333',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}
                      >
                        🛒 SET
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 'bold' }}>
                        {totalCount} 中 {currentNum}
                      </span>
                    </span>
                  </div>
                );
              }
            }
            return null;
          })()}
        </div>
      </td>
      <td>
        <div className="product-name">
          {item.product_name || '-'}
          {item.product_name_sub && (
            <>
              <br />
              {item.product_name_sub}
            </>
          )}
          {item.barcode && (
            <>
              <br />
              {item.barcode}
              {item.option_id ? ` | ${item.option_id}` : ''}
              {item.product_size && String(item.product_size).trim() ? ` | ${(() => {
                const sizeText = String(item.product_size).trim();
                if (sizeText.toLowerCase().includes('small')) return 'A';
                if (sizeText.toLowerCase().includes('medium')) return 'B';
                if (sizeText.toLowerCase().includes('large')) return 'C';
                return sizeText.charAt(0);
              })()}` : ''}
            </>
          )}
          <div style={{ marginTop: '4px' }}>
            {item.fabric_blend && String(item.fabric_blend).trim() ? (
              <span className="label-badge fabric">{t('importProduct.badge.fabricLabel')}</span>
            ) : (item.order_qty ?? 0) < 10 ? (
              <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
            ) : (
              <span className="label-badge stop">{t('importProduct.badge.stopWork')}</span>
            )}
          </div>
        </div>
      </td>
      <td>
        <div className="china-options">
          {item.china_option1 || '-'}
          {item.china_option2 && (
            <>
              <br />
              {item.china_option2}
            </>
          )}
        </div>
      </td>
      <td style={{ textAlign: 'center' }}>
        {item.order_qty || 0}
      </td>
      <td>
        <div
          className="cost-display clickable-cost"
          onClick={(e) => onCostClick(e, item)}
          title={item.site_url ? '클릭하여 사이트로 이동' : 'URL을 입력하여 사이트로 이동'}
        >
          {item.cost_main || '-'}
          {item.cost_sub && (
            <>
              <br />
              {item.cost_sub}
            </>
          )}
        </div>
      </td>
      <td className="qty-cell">
        {item.progress_qty && (
          <span className="qty-badge progress-qty">
            {item.progress_qty}
          </span>
        )}
      </td>
      <EditableCell
        id={item.id}
        field="import_qty"
        value={item.import_qty}
        isEditing={editingCell?.id === item.id && editingCell?.field === 'import_qty'}
        editValue={cellValue}
        type="number"
        onStartEdit={onStartEditingCell}
        onValueChange={onCellValueChange}
        onKeyDown={onHandleCellKeyDown}
        onFinishEdit={onFinishEditingCell}
        className="qty-cell editable-qty-cell"
      />
      <td className="qty-cell">
        {item.cancel_qty && (
          <span className="qty-badge cancel-qty">
            {item.cancel_qty}
          </span>
        )}
      </td>
      <td className="qty-cell">
        {item.export_qty && (
          <span className="qty-badge export-qty">
            {item.export_qty}
          </span>
        )}
      </td>
      <EditableCell
        id={item.id}
        field="note"
        value={item.note}
        isEditing={editingCell?.id === item.id && editingCell?.field === 'note'}
        editValue={cellValue}
        type="text"
        onStartEdit={onStartEditingCell}
        onValueChange={(e) => onSetCellValue(e.target.value)}
        onKeyDown={onHandleCellKeyDown}
        onFinishEdit={onFinishEditingCell}
        className="editable-note-cell"
      />
      <td>
        <div style={{ lineHeight: '1.5', fontSize: '14px', color: '#333' }}>
          {item.order_id && <div>{item.order_id}</div>}
          {item.delivery_status && (
            <div style={{ marginTop: '4px' }}>
              {item.delivery_status === '等待买家确认收货' && '🟢 等待买家确认收货'}
              {item.delivery_status === '交易关闭' && '🏁 交易关闭'}
              {item.delivery_status === '退款中' && '↩️ 退款中'}
              {item.delivery_status === '等待卖家发货' && '🟡 等待卖家发货'}
              {item.delivery_status === '交易成功' && '✔️ 交易成功'}
              {!['等待买家确认收货', '交易关闭', '退款中', '等待卖家发货', '交易成功'].includes(item.delivery_status) && item.delivery_status}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

export default ItemTableRow;
