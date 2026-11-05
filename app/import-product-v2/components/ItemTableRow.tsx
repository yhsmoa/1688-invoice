'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import EditableCell from './EditableCell';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import TypeBadge from '../../../component/TypeBadge';
import { resolveQtyStatus, type QtyCell } from '../utils/qtyStatus';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';

/* V2 전용 ItemTableRow - 원래 13열 구조 유지, 입고 열 편집 가능 */

// ============================================================
// 렌더 비용 — 이 컴포넌트는 React.memo 로 감싼다.
//   한 페이지에 행 20~40개, 행마다 이미지 2장이라 키 입력·마우스 이동마다 전부 다시 그리면
//   작업 셀 타이핑이 밀린다. 그래서
//   · 편집 상태는 "이 행" 기준 값(editingField / editValue / isCategoryEditing)만 받는다
//     → 다른 행은 props 가 안 바뀌어 다시 그리지 않는다
//   · 이미지 미리보기 위치는 state 가 아니라 레이아웃 컨테이너의 CSS 변수(--v2-mouse-x/y)
//   · 핸들러는 부모가 참조를 고정해서 넘긴다 (hooks/useStableCallback)
// ============================================================

/** 세트 그룹 안에서의 위치 — 체크박스 옆 중괄호 묶음선(first/mid/last/only) 그리기용 */
export type SetGroupPos = 'first' | 'mid' | 'last' | 'only';

interface ItemTableRowProps {
  item: FtOrderItem;
  isSelected: boolean;
  /** 다음 행과 같은 product_id 그룹이면 true → border 제거 */
  sameGroupAsNext: boolean;
  /** 세트 그룹 안 위치 (세트가 아니면 undefined) */
  setGroupPos?: SetGroupPos;
  /** 같은 세트인데 1688 주문번호가 서로 다름 (다른 판매자에게서 옴) */
  setMixedSeller?: boolean;
  /** V3 펼침 테이블 — 작은 이미지, 한국어 상품명·옵션명 줄 없음, 비용 열 없음, 낮은 행 */
  compact?: boolean;
  /** 이 행에서 편집 중인 필드 — 아니면 null (다른 행 편집 중이어도 null) */
  editingField: string | null;
  /** 이 행이 편집 중일 때의 입력값 — 아니면 '' */
  editValue: string;
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
  /** 운송장 출력 가능 여부 — false 면 동일 송장 다른 조합으로 이미 출력됨 (차단) */
  isInvoicePrintable: boolean;
  onSelectRow: (id: string, checked: boolean) => void;
  onStartEditingCell: (id: string, field: string, value: number | string | null | undefined) => void;
  onCellValueChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFinishEditingCell: () => void;
  onProductNameClick: (item: FtOrderItem) => void;
  /** 이 행의 품목(customs_category) 편집 중 여부 */
  isCategoryEditing: boolean;
  /** 이 행이 품목 편집 중일 때의 입력값 — 아니면 '' */
  categoryValue: string;
  onStartCategoryEdit: (id: string, currentValue: string | null) => void;
  onCategoryValueChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCategoryKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFinishCategoryEdit: () => void;
}

// ── 수량 칸 배지 — 색은 utils/qtyStatus 의 tone 으로만 정한다 ──
const QtyBadge: React.FC<{ cell: QtyCell }> = ({ cell }) =>
  cell.tone === 'none' ? (
    <span className="v2-qty-none" aria-hidden="true">–</span>
  ) : (
    <span className={`v2-qty-badge v2-qty--${cell.tone}`}>{cell.value}</span>
  );

const ItemTableRow: React.FC<ItemTableRowProps> = ({
  item,
  isSelected,
  sameGroupAsNext,
  setGroupPos,
  setMixedSeller = false,
  compact = false,
  editingField,
  editValue,
  importQtyValue,
  arrivalQty,
  packedQty,
  cancelQty,
  returnQty,
  shippedItemQty,
  shipmentQty,
  hasInvoicePdf,
  isInvoicePrintable,
  onSelectRow,
  onStartEditingCell,
  onCellValueChange,
  onCellKeyDown,
  onFinishEditingCell,
  onProductNameClick,
  isCategoryEditing,
  categoryValue,
  onStartCategoryEdit,
  onCategoryValueChange,
  onCategoryKeyDown,
  onFinishCategoryEdit,
}) => {
  const { t } = useTranslation();

  // 진행·입고·포장·취소·출고 — 값과 색을 한 곳(utils/qtyStatus)에서 판정
  //   진행 = order_qty - CANCEL - RETURN - 출고완료PACKED (raw, 종결 잔여 의미)
  //   취소 = CANCEL + RETURN 합산 표시 (사용자 결정: 단일 컬럼 합산)
  const qty = resolveQtyStatus({
    orderQty: item.order_qty ?? 0,
    arrivalQty,
    packedQty,
    cancelQty,
    returnQty,
    shippedItemQty,
    shipmentDisplayQty: shipmentQty,
  });

  // 입고 열에 표시할 값: 수정값 > 0이면 수정값, 아니면 빈칸
  const displayImportQty = importQtyValue != null ? importQtyValue : null;

  // 세트상품 여부 (세트 배지 표시 조건과 동일)
  const isSetProduct = item.set_total != null && item.set_total > 1;

  const rowClasses = [
    sameGroupAsNext ? 'v2-same-product-group' : '',
    isSetProduct ? 'v2-set-product-row' : '',
    isSetProduct && setGroupPos ? `v2-set-pos-${setGroupPos}` : '',
    isSelected ? 'v2-row-selected' : '',
    displayImportQty != null && displayImportQty > 0 ? 'v2-row-has-work' : '',
    compact ? 'v2-row-compact' : '',
  ].filter(Boolean).join(' ');

  // 세트 묶음선·배지 색은 CSS 한 가지(주황) — 그룹별 색 순환 없음

  return (
    <tr className={rowClasses}>
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
              src={proxyImageUrl(item.img_url, THUMB_WIDTH)}
              alt="상품 이미지"
              className="v2-product-thumbnail"
              // 검색 결과 전체 표시 시 화면 밖 행의 이미지는 스크롤해 올 때 불러온다
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/placeholder.svg';
              }}
            />
            {/* 위치는 CSS 변수(--v2-mouse-x/y, 레이아웃 컨테이너가 mousemove 로 갱신) */}
            <div className="v2-image-preview">
              <img
                src={proxyImageUrl(item.img_url)}
                alt="상품 이미지 미리보기"
                loading="lazy"
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
          {/* 세트상품 배지: set_total > 1 인 경우 글번호 위에 표시
               같은 세트인데 1688 주문번호가 다르면 (다른 판매자) 를 붙이고 색을 바꾼다 */}
          {isSetProduct && (
            <>
              <span className={`v2-set-badge ${setMixedSeller ? 'is-mixed' : ''}`}>
                {t('importProductV2.set.label')} {item.set_total}中{item.set_seq ?? '?'}
                {setMixedSeller && ` (${t('importProductV2.set.mixed')})`}
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
                  {/* 타입 배지 A/B/C/P/X — 보관 상품은 S (입고 작업자가 "이건 재고 위치로" 를 입고 시점에 보게) */}
                  <TypeBadge item={item} />
                  {/* ── P(PERSONAL) 전용: 원산지 + 운송장 출력 2개 고정 ──
                       A/B/C/X: composition/order_qty 기반 기존 3-way */}
                  {isPersonal ? (
                    <>
                      <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
                      {/* '운송장 출력' 배지: PDF 존재 + 출력 가능(첫 출력 또는 같은 조합) 일 때만 노출.
                          이미 다른 조합으로 출력된 송장은 배지 자체를 숨김 (UI 단순화) */}
                      {hasInvoicePdf && isInvoicePrintable && (
                        <span className="label-badge shipping">
                          {t('importProduct.badge.shippingLabel')}
                        </span>
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
                     배지와 동일 조건(hasInvoicePdf + isInvoicePrintable) 으로 일관성 유지 */}
                {isPersonal && hasInvoicePdf && isInvoicePrintable && item.personal_order_no && (
                  <div className="v2-personal-order-no-line">
                    <span className="v2-personal-order-no-connector">ㄴ</span>
                    <span className="v2-personal-order-no-value">{item.personal_order_no}</span>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── 2·3번째 줄: item_name / option_name — compact(V3) 에서는 숨김 (보드 헤더에 있음) ── */}
          {!compact && <div>{item.item_name || ''}</div>}
          {!compact && item.option_name && <div>{item.option_name}</div>}

          {/* ── 맨 아래: note_cn — 깜빡이는 빨간 배지 (V2 전용 is-alert, V3 는 빨간 글씨 그대로) ── */}
          {item.note_cn && String(item.note_cn).trim() && (
            <div className="v2-note-cn is-alert">{item.note_cn}</div>
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

      {/* 비용 (price_cny / price_total_cny) — 가운데 정렬. compact(V3) 에서는 열 자체를 뺀다 */}
      {!compact && (
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
      )}

      {/* 진행 = 개수 - 취소 - 반품 - 출고완료 (아직 들어올 게 있으면 주황, 다 들어왔으면 회색) */}
      <td className="v2-qty-cell">
        <QtyBadge cell={qty.progress} />
      </td>

      {/* 작업 — 편집 가능 셀, 파스텔 노란 배경 */}
      <EditableCell
        id={item.id}
        field="import_qty"
        value={displayImportQty}
        isEditing={editingField === 'import_qty'}
        editValue={editValue}
        type="number"
        onStartEdit={onStartEditingCell}
        onValueChange={onCellValueChange}
        onKeyDown={onCellKeyDown}
        onFinishEdit={() => onFinishEditingCell()}
        className="v2-qty-cell v2-editable-qty-cell v2-work-cell"
      />

      {/* 입고 — ARRIVAL 합계 (다 들어오면 초록, 덜 들어오면 주황) */}
      <td className="v2-qty-cell">
        <QtyBadge cell={qty.arrival} />
      </td>

      {/* 포장 — PACKED 합계 (손에 있는 수량을 다 포장하면 초록) */}
      <td className="v2-qty-cell">
        <QtyBadge cell={qty.packed} />
      </td>

      {/* 취소 — CANCEL + RETURN 합산 (항상 빨강) */}
      <td className="v2-qty-cell">
        <QtyBadge cell={qty.cancel} />
      </td>

      {/* 출고 — 출고완료 합계 (출고가 남았으면 주황, 끝나면 회색) */}
      <td className="v2-qty-cell">
        <QtyBadge cell={qty.ship} />
      </td>
    </tr>
  );
};

export default React.memo(ItemTableRow);
