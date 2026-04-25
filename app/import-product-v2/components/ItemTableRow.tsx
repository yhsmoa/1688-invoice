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
  /** ft_fulfillment_inbounds type=ARRIVAL quantity 합계 */
  arrivalQty: number;
  /** ft_fulfillment_outbounds type=PACKED quantity 합계 (전체) */
  packedQty: number;
  /** ft_fulfillment_inbounds type=CANCEL quantity 합계 (raw) — 주문 취소 */
  cancelQty: number;
  /** ft_fulfillment_inbounds type=RETURN quantity 합계 (raw) — 반품 접수 */
  returnQty: number;
  /** PACKED + shipment_id NOT NULL (item 기준) — 진행 공식용 */
  shippedItemQty: number;
  /** product_id 기준 출고 합계 (출고 컬럼 표시용) */
  shipmentQty: number;
  /** Storage 에 해당 personal_order_no.pdf 존재 여부 — P 배지 '운송장 출력' 조건 */
  hasInvoicePdf: boolean;
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
  returnQty,
  shippedItemQty,
  shipmentQty,
  hasInvoicePdf,
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

  // 진행 = order_qty - CANCEL - RETURN - 출고완료PACKED (raw, 종결 잔여 의미)
  //   - CANCEL: 주문 취소 (단순 접수도 차감 — raw)
  //   - RETURN: 반품 접수 (입고 후 돌려보냄, 단순 접수도 차감 — raw)
  //   - 출고완료PACKED: shipment_id 부여된 PACKED (출고 V2 → 쉽먼트 V2 [출고] 시점)
  const progressQty =
    (item.order_qty ?? 0) - cancelQty - returnQty - shippedItemQty;

  // 취소 컬럼 표시값 — CANCEL + RETURN 합산 (사용자 결정: 단일 컬럼 합산)
  const cancelDisplayQty = cancelQty + returnQty;

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

      {/* 글번호 (item_no) — 세트상품 배지 / item_no / barcode / 1688_order_id */}
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
          {/* item_no */}
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
          {/* barcode — item_no 와 1688_order_id 사이 (상품명에서 이동) */}
          {item.barcode && (
            <div className="v2-barcode-inline">{item.barcode}</div>
          )}
          {/* 1688 주문 ID */}
          {item['1688_order_id'] && (
            <div className="v2-order-id-sub">{item['1688_order_id']}</div>
          )}
        </div>
      </td>

      {/* 상품명 — 맨 위: 배지(사이즈+라벨), 중간: item_name/option_name, 맨 아래: note_cn */}
      <td onClick={() => onProductNameClick(item)} style={{ cursor: 'pointer' }}>
        <div className="v2-product-name">
          {(() => {
            const sizeBadge = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
            const isPersonal = sizeBadge?.code === 'P';
            return (
              <>
                {/* ── 1번째 줄: 사이즈 배지(A/B/C/P/X) + 라벨 배지 ── */}
                <div className="v2-product-name-badges">
                  {sizeBadge && (
                    <span className={`size-badge ${sizeBadge.colorClass}`}>{sizeBadge.code}</span>
                  )}
                  {/* ── P(PERSONAL) 전용: 원산지 + 운송장 출력 2개 고정 ──
                       A/B/C/X: composition/order_qty 기반 기존 3-way */}
                  {isPersonal ? (
                    <>
                      <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
                      {/* '운송장 출력' 배지: Storage 에 매칭 PDF 가 존재할 때만 표시 */}
                      {hasInvoicePdf && (
                        <span className="label-badge shipping">{t('importProduct.badge.shippingLabel')}</span>
                      )}
                    </>
                  ) : item.composition && String(item.composition).trim() ? (
                    <span className="label-badge fabric">{t('importProduct.badge.fabricLabel')}</span>
                  ) : (item.order_qty ?? 0) < 10 ? (
                    <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
                  ) : (
                    <span className="label-badge stop">{t('importProduct.badge.stopWork')}</span>
                  )}
                </div>

                {/* ── 1-1번째 줄(P 전용): personal_order_no — '운송장 출력' 배지와 세트 노출 ──
                     hasInvoicePdf 조건으로 송장 출력 배지와 동일하게 PDF 매칭된 경우만 표시 */}
                {isPersonal && hasInvoicePdf && item.personal_order_no && (
                  <div className="v2-personal-order-no-line">
                    <span className="v2-personal-order-no-connector">ㄴ</span>
                    <span className="v2-personal-order-no-value">{item.personal_order_no}</span>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── 2번째 줄: item_name ── */}
          <div>{item.item_name || ''}</div>

          {/* ── 3번째 줄: option_name ── */}
          {item.option_name && <div>{item.option_name}</div>}

          {/* ── 맨 아래: note_cn (빨간색) ── */}
          {item.note_cn && String(item.note_cn).trim() && (
            <div className="v2-note-cn">{item.note_cn}</div>
          )}
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

      {/* 취소 — CANCEL + RETURN 합산 표시 (사용자 결정: 단일 컬럼) */}
      <td className="v2-qty-cell" style={{ textAlign: 'center' }}>
        {cancelDisplayQty > 0 && (
          <span className="v2-qty-badge v2-cancel-qty">{cancelDisplayQty}</span>
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
