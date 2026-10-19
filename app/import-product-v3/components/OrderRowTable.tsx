'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import type { BatchStatus } from '../hooks/useAllocationBatch';

// ============================================================
// 모달 오른쪽 — 선택한 옵션의 주문행 표
//
//   ☐ | 글번호 | 상품명 | 주문옵션 | 개수 | 진행 | 작업 | 입고 | 포장 | 취소 | 출고
//
//   열 계산은 V2 ItemTableRow 와 동일
//     진행 = order_qty − CANCEL − RETURN − 출고완료PACKED
//     취소 = CANCEL + RETURN,  포장·출고 = product_id 기준 합계
//   작업 셀은 행 단위로 직접 고칠 수 있다 (한도 = 그 행 잔여). 옵션 수량을 다시
//   입력하면 자동 배분이 덮어쓴다.
//   상품명 클릭 → 처리 로그 (V2 FulfillmentLogModal)
// ============================================================

export interface RowMaps {
  arrivalMap: Map<string, number>;
  cancelMap: Map<string, number>;
  returnMap: Map<string, number>;
  /** product_id 기준 */
  packedMap: Map<string, number>;
  shippedItemMap: Map<string, number>;
  /** product_id 기준 */
  exportMap: Map<string, number>;
}

interface OrderRowTableProps {
  title: string;
  rows: FtOrderItem[];
  maps: RowMaps;
  alloc: Map<string, number>;
  status: BatchStatus;
  selectedIds: Set<string>;
  disabled: boolean;
  invoicePdfSet: Set<string>;
  isItemInvoicePrintable: (item: FtOrderItem) => boolean;
  onToggleRow: (id: string, checked: boolean) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  /** 행 작업 수량 확정 — 받아들였으면 true */
  onCommitRow: (rowId: string, qty: number) => boolean;
  onProductNameClick: (item: FtOrderItem) => void;
}

const OrderRowTable: React.FC<OrderRowTableProps> = ({
  title,
  rows,
  maps,
  alloc,
  status,
  selectedIds,
  disabled,
  invoicePdfSet,
  isItemInvoicePrintable,
  onToggleRow,
  onToggleAll,
  onCommitRow,
  onProductNameClick,
}) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // 표시 행이 바뀌면 입력 초안 초기화
  const rowsKey = rows.map((r) => r.id).join(',');
  useEffect(() => setDrafts({}), [rowsKey]);

  const ids = rows.map((r) => r.id);
  const allChecked = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const someChecked = ids.some((id) => selectedIds.has(id));

  const commit = (rowId: string) => {
    const draft = drafts[rowId];
    if (draft === undefined) return;
    const qty = draft.trim() === '' ? 0 : parseInt(draft, 10) || 0;
    onCommitRow(rowId, qty);
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  };

  return (
    <div className="v3-row-table-wrap">
      <div className="v3-row-table-title">
        {title}
        <span className="v3-row-table-count">{t('importProductV3.modal.rows', { count: rows.length })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="v3-row-table-empty">{t('importProductV3.modal.selectOption')}</div>
      ) : (
        <div className="v3-row-table-scroll">
          <table className="v3-row-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = someChecked && !allChecked;
                    }}
                    onChange={(e) => onToggleAll(ids, e.target.checked)}
                  />
                </th>
                <th>{t('importProductV2.table.orderNumber')}</th>
                <th>{t('importProductV2.table.productName')}</th>
                <th>{t('importProductV2.table.orderOption')}</th>
                <th>{t('importProductV2.table.quantity')}</th>
                <th>{t('importProductV2.table.progress')}</th>
                <th className="v3-col-work">{t('importProductV2.table.work')}</th>
                <th>{t('importProductV2.table.arrival')}</th>
                <th>{t('importProductV2.table.packed')}</th>
                <th>{t('importProductV2.table.cancel')}</th>
                <th>{t('importProductV2.table.export')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                // ── V2 ItemTableRow 와 같은 공식 ──
                const arrivalQty = maps.arrivalMap.get(item.id) ?? 0;
                const cancelQty = maps.cancelMap.get(item.id) ?? 0;
                const returnQty = maps.returnMap.get(item.id) ?? 0;
                const shippedItemQty = maps.shippedItemMap.get(item.id) ?? 0;
                const packedQty = maps.packedMap.get(item.product_id ?? '') ?? 0;
                const exportQty = maps.exportMap.get(item.product_id ?? '') ?? 0;
                const progressQty = (item.order_qty ?? 0) - cancelQty - returnQty - shippedItemQty;
                const cancelDisplayQty = cancelQty + returnQty;
                const remaining = Math.max(0, (item.order_qty ?? 0) - arrivalQty - cancelQty);

                const allocQty = alloc.get(item.id) ?? 0;
                const workValue = drafts[item.id] ?? (status === 'editing' && allocQty > 0 ? String(allocQty) : '');

                const sizeBadge = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
                const isPersonal = sizeBadge?.code === 'P';
                const hasPdf = !!item.personal_order_no && invoicePdfSet.has(item.personal_order_no);
                const printable = isItemInvoicePrintable(item);
                const isSet = item.set_total != null && item.set_total > 1;

                return (
                  <tr key={item.id} className={remaining === 0 ? 'v3-row-closed' : ''}>
                    {/* 체크박스 */}
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={(e) => onToggleRow(item.id, e.target.checked)}
                      />
                    </td>

                    {/* 글번호 — 세트 배지 / item_no / barcode / 1688 주문 ID */}
                    <td className="v3-col-order">
                      {isSet && (
                        <span className="v2-set-badge">
                          🎁 {item.set_total} 中 {item.set_seq ?? '?'}
                        </span>
                      )}
                      <div>
                        {item.site_url ? (
                          <a href={item.site_url} target="_blank" rel="noopener noreferrer" className="v2-item-no-link">
                            {item.item_no || ''}
                          </a>
                        ) : (
                          item.item_no || ''
                        )}
                      </div>
                      {item.barcode && <div className="v2-barcode-inline">{item.barcode}</div>}
                      {item['1688_order_id'] && <div className="v2-order-id-sub">{item['1688_order_id']}</div>}
                    </td>

                    {/* 상품명 — 배지 / 상품명 / 옵션 / 비고(note_cn) */}
                    <td className="v3-col-name" onClick={() => onProductNameClick(item)}>
                      <div className="v2-product-name-badges">
                        {sizeBadge && <span className={`size-badge ${sizeBadge.colorClass}`}>{sizeBadge.code}</span>}
                        {isPersonal ? (
                          <>
                            <span className="label-badge origin">{t('importProduct.badge.originStamp')}</span>
                            {hasPdf && printable && (
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
                      {isPersonal && hasPdf && printable && item.personal_order_no && (
                        <div className="v2-personal-order-no-line">
                          <span className="v2-personal-order-no-connector">ㄴ</span>
                          <span className="v2-personal-order-no-value">{item.personal_order_no}</span>
                        </div>
                      )}
                      <div>{item.item_name || ''}</div>
                      {item.option_name && <div className="v3-col-name-option">{item.option_name}</div>}
                      {item.note_cn && String(item.note_cn).trim() && <div className="v2-note-cn">{item.note_cn}</div>}
                    </td>

                    {/* 주문옵션 */}
                    <td className="v3-col-china">
                      {item.china_option1 || ''}
                      {item.china_option2 && (
                        <>
                          <br />
                          {item.china_option2}
                        </>
                      )}
                    </td>

                    {/* 개수 */}
                    <td className="v3-col-num">{item.order_qty ?? ''}</td>

                    {/* 진행 */}
                    <td className="v3-col-num">
                      {progressQty > 0 && <span className="v2-qty-badge v2-progress-qty">{progressQty}</span>}
                    </td>

                    {/* 작업 — 행 단위 수정 (한도 = 잔여) */}
                    <td className="v3-col-work">
                      <input
                        // 저장 전 작업 수량이 들어간 칸은 배경이 연하게 깜빡인다 (어느 행에 들어갔는지 한눈에)
                        className={`v3-work-input ${workValue !== '' ? 'v3-work-input--filled' : ''}`}
                        type="text"
                        inputMode="numeric"
                        value={workValue}
                        placeholder={remaining > 0 ? String(remaining) : ''}
                        disabled={disabled || remaining === 0}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^0-9]/g, '');
                          setDrafts((prev) => ({ ...prev, [item.id]: cleaned }));
                        }}
                        onBlur={() => commit(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          } else if (e.key === 'Escape') {
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                          }
                        }}
                      />
                      {status === 'saved' && allocQty > 0 && <div className="v3-work-saved">✓ {allocQty}</div>}
                    </td>

                    {/* 입고 */}
                    <td className="v3-col-num">
                      {arrivalQty > 0 && <span className="v2-qty-badge v2-import-qty">{arrivalQty}</span>}
                    </td>

                    {/* 포장 */}
                    <td className="v3-col-num">
                      {packedQty > 0 && <span className="v2-qty-badge v2-packed-qty">{packedQty}</span>}
                    </td>

                    {/* 취소 (CANCEL + RETURN) */}
                    <td className="v3-col-num">
                      {cancelDisplayQty > 0 && <span className="v2-qty-badge v2-cancel-qty">{cancelDisplayQty}</span>}
                    </td>

                    {/* 출고 */}
                    <td className="v3-col-num">
                      {exportQty > 0 && <span className="v2-qty-badge v2-export-qty">{exportQty}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrderRowTable;
