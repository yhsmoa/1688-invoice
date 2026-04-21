'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import EditableCell from './EditableCell';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import { resolveSetGroupColor } from '../utils/setGroupPalette';

/* V2 전용 ItemTableRow - 원래 13열 구조 유지, 입고 열 편집 가능 */

interface ItemTableRowProps {
  item: FtOrderItem;
  isSelected: boolean;
  /** 다음 행과 같은 product_id 그룹이면 true → border 제거 */
  sameGroupAsNext: boolean;
  /** 세트 그룹 색상 인덱스 (set_total > 1 인 행에만 지정). undefined면 기본 주황 fallback */
  setColorIndex?: number;
  mousePosition: { x: number; y: number };
  editingCell: { id: string; field: string } | null;
  cellValue: string;
  importQtyValue: number | undefined;
  /** ft_fulfillments type=ARRIVAL quantity 합계 */
  arrivalQty: number;
  /** ft_fulfillments type=PACKED quantity 합계 */
  packedQty: number;
  /** ft_fulfillments type=CANCEL quantity 합계 */
  cancelQty: number;
  /** ft_fulfillments type=SHIPMENT quantity 합계 */
  shipmentQty: number;
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

const ItemTableRow: React.FC<ItemTableRowProps> = ({
  item,
  isSelected,
  sameGroupAsNext,
  setColorIndex,
  mousePosition,
  editingCell,
  cellValue,
  importQtyValue,
  arrivalQty,
  packedQty,
  cancelQty,
  shipmentQty,
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

  // 진행 = 개수 - 입고 - 취소
  const progressQty = (item.order_qty ?? 0) - arrivalQty - cancelQty;

  // 입고 열에 표시할 값: 수정값 > 0이면 수정값, 아니면 빈칸
  const displayImportQty = importQtyValue != null ? importQtyValue : null;

  // 세트상품 여부 (🎁 배지 표시 조건과 동일)
  const isSetProduct = item.set_total != null && item.set_total > 1;

  const rowClasses = [
    sameGroupAsNext ? 'v2-same-product-group' : '',
    isSetProduct ? 'v2-set-product-row' : '',
  ].filter(Boolean).join(' ');

  // ── 세트 그룹 색상 CSS 변수 (인덱스 기반 팔레트 순환) ──
  //    setColorIndex가 undefined이면 style 미지정 → CSS fallback 주황 적용
  const rowStyle: React.CSSProperties | undefined =
    setColorIndex != null
      ? ({
          ['--set-accent' as string]: resolveSetGroupColor(setColorIndex).border,
          ['--set-bg' as string]: resolveSetGroupColor(setColorIndex).bg,
          ['--set-text' as string]: resolveSetGroupColor(setColorIndex).text,
        } as React.CSSProperties)
      : undefined;

  return (
    <tr className={rowClasses} style={rowStyle}>
      {/* 체크박스 */}
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelectRow(item.id, e.target.checked)}
          className="v2-table-checkbox"
        />
      </td>

      {/* 이미지 (img_url → image-proxy 경유) */}
      <td>
        {item.img_url ? (
          <div className="v2-image-preview-container">
            <img
              src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
              alt="상품 이미지"
              className="v2-product-thumbnail"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
            <div
              className="v2-image-preview"
              style={{
                top: `${mousePosition.y - 300}px`,
                left: `${mousePosition.x + 30}px`,
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
          <div className="v2-no-image">-</div>
        )}
      </td>

      {/* 글번호 (item_no) — 세트상품 배지(위) + site_url 링크(아래) */}
      <td>
        <div className="v2-order-number-text">
          {/* 세트상품 배지: set_total > 1 인 경우 글번호 위에 표시 */}
          {item.set_total != null && item.set_total > 1 && (
            <>
              <span className="v2-set-badge">
                🎁 {item.set_total} 中 {item.set_seq ?? '?'}
              </span>
              <br />
            </>
          )}
          {item.site_url ? (
            <a
              href={item.site_url}
              target="_blank"
              rel="noopener noreferrer"
              className="v2-item-no-link"
            >
              {item.item_no || ''}
            </a>
          ) : (
            item.item_no || ''
          )}
          {/* 1688 주문 ID — 회색, 작은 폰트로 글번호 아래 표시 */}
          {item['1688_order_id'] && (
            <div className="v2-order-id-sub">{item['1688_order_id']}</div>
          )}
        </div>
      </td>

      {/* 상품명 (item_name + option_name + barcode + coupang_shipment_size) — 클릭 시 로그 모달 */}
      <td onClick={() => onProductNameClick(item)} style={{ cursor: 'pointer' }}>
        <div className="v2-product-name">
          {item.item_name || ''}
          {item.option_name && (
            <>
              <br />
              {item.option_name}
            </>
          )}
          {item.barcode && (() => {
            // shipment_type 우선: DIRECT→X / PERSONAL→P / COUPANG→size(A/B/C)
            const badge = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
            return (
              <>
                <br />
                {item.barcode}
                {badge && (
                  <span
                    className={`size-badge ${badge.colorClass}`}
                    style={{ marginLeft: '4px' }}
                  >
                    {badge.code}
                  </span>
                )}
              </>
            );
          })()}
          {/* ── 상품명 라벨 배지 (V1과 동일 우선순위) ──
                1. composition 존재            → 🟦 혼용률 라벨 출력
                2. order_qty < 10             → 🟧 원산지 도장/봉제
                3. order_qty >= 10            → 🟥 입고만 입력 후 매니저에게 전달 */}
          <div style={{ marginTop: '4px' }}>
            {item.composition && String(item.composition).trim() ? (
              <span className="label-badge fabric">{t('importProduct.badge.fabricLabel')}</span>
            ) : (item.order_qty ?? 0) < 10 ? (
              <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
            ) : (
              <span className="label-badge stop">{t('importProduct.badge.stopWork')}</span>
            )}
          </div>
        </div>
      </td>

      {/* 주문옵션 (china_option1 + china_option2) */}
      <td>
        <div className="v2-china-options">
          {item.china_option1 || ''}
          {item.china_option2 && (
            <>
              <br />
              {item.china_option2}
            </>
          )}
        </div>
      </td>

      {/* 수량 (order_qty) */}
      <td style={{ textAlign: 'center' }}>
        {item.order_qty ?? ''}
      </td>

      {/* 비용 (price_cny / price_total_cny) — 가운데 정렬 */}
      <td style={{ textAlign: 'center' }}>
        <div className="v2-cost-display" style={{ textAlign: 'center' }}>
          {item.price_cny != null ? `¥${item.price_cny}` : ''}
          {item.price_total_cny != null && (
            <>
              <br />
              {`¥${item.price_total_cny}`}
            </>
          )}
        </div>
      </td>

      {/* 진행 = 개수 - 입고 - 취소 */}
      <td className="v2-qty-cell">
        {progressQty > 0 && (
          <span className="v2-qty-badge v2-progress-qty">{progressQty}</span>
        )}
      </td>

      {/* 작업 — 편집 가능 셀, 파스텔 노란 배경 */}
      <EditableCell
        id={item.id}
        field="import_qty"
        value={displayImportQty}
        isEditing={editingCell?.id === item.id && editingCell?.field === 'import_qty'}
        editValue={cellValue}
        type="number"
        onStartEdit={onStartEditingCell}
        onValueChange={onCellValueChange}
        onKeyDown={onCellKeyDown}
        onFinishEdit={() => onFinishEditingCell()}
        className="v2-qty-cell v2-editable-qty-cell v2-work-cell"
      />

      {/* 입고 — ft_fulfillments type=ARRIVAL quantity 합계 */}
      <td className="v2-qty-cell" style={{ textAlign: 'center' }}>
        {arrivalQty > 0 && (
          <span className="v2-qty-badge v2-import-qty">{arrivalQty}</span>
        )}
      </td>

      {/* 포장 — ft_fulfillments type=PACKED quantity 합계 */}
      <td className="v2-qty-cell" style={{ textAlign: 'center' }}>
        {packedQty > 0 && (
          <span className="v2-qty-badge v2-packed-qty">{packedQty}</span>
        )}
      </td>

      {/* 취소 — ft_fulfillments type=CANCEL quantity 합계 */}
      <td className="v2-qty-cell" style={{ textAlign: 'center' }}>
        {cancelQty > 0 && (
          <span className="v2-qty-badge v2-cancel-qty">{cancelQty}</span>
        )}
      </td>

      {/* 출고 — ft_fulfillments type=SHIPMENT quantity 합계 */}
      <td className="v2-qty-cell" style={{ textAlign: 'center' }}>
        {shipmentQty > 0 && (
          <span className="v2-qty-badge v2-export-qty">{shipmentQty}</span>
        )}
      </td>
    </tr>
  );
};

export default ItemTableRow;
