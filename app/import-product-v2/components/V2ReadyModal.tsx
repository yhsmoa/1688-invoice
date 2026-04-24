'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import './V2ReadyModal.css';

// ============================================================
// V2 처리준비 모달 - 수정된 입고 데이터 리스트 표시
// "postgre + 저장" 클릭 시:
//   1) invoice_fashion_label 저장 (LABEL postgre 동일 로직)
//   2) ft_fulfillments 저장 (ARRIVAL)
// ============================================================

export interface V2ReadyItem {
  item: FtOrderItem;
  import_qty: number;
}

interface V2ReadyModalProps {
  isOpen: boolean;
  onClose: () => void;
  readyItems: V2ReadyItem[];
  /** postgre + 저장 핸들러 (ItemCheck에서 전달) */
  onSavePostgre: () => Promise<void>;
  /** 송장 출력 핸들러 (P 상품 PDF 병합 인쇄). 미제공 시 버튼 숨김 */
  onPrintInvoices?: () => Promise<void> | void;
  /** 송장 출력 가능 여부 (체크된 P 상품 중 Storage 에 PDF 존재 ≥ 1) */
  invoicePrintable?: boolean;
  /** 저장 완료 플래그 — true 면 저장 버튼 비활성 + "저장 완료" 표시 (중복 저장 방지) */
  isSaved?: boolean;
  /** Storage 에 PDF 가 존재하는 personal_order_no Set — personal_order_no 인라인 노출 조건 */
  invoicePdfSet?: Set<string>;
}

const V2ReadyModal: React.FC<V2ReadyModalProps> = ({
  isOpen,
  onClose,
  readyItems,
  onSavePostgre,
  onPrintInvoices,
  invoicePrintable = false,
  isSaved = false,
  invoicePdfSet,
}) => {
  const { t } = useTranslation();

  // ============================================================
  // 저장 / 인쇄 로딩 상태
  // ============================================================
  const [isSaving, setIsSaving] = useState(false);
  const [isPrintingInvoices, setIsPrintingInvoices] = useState(false);

  // ============================================================
  // postgre + 저장 클릭 핸들러
  // ============================================================
  const handleSavePostgre = async () => {
    setIsSaving(true);
    try {
      await onSavePostgre();
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // 송장 출력 클릭 핸들러 (P 상품 PDF 병합 인쇄)
  // ============================================================
  const handlePrintInvoices = async () => {
    if (!onPrintInvoices) return;
    setIsPrintingInvoices(true);
    try {
      await onPrintInvoices();
    } finally {
      setIsPrintingInvoices(false);
    }
  };

  return (
    <>
      {/* ============================================================ */}
      {/* 배경 오버레이 */}
      {/* ============================================================ */}
      {isOpen && (
        <div className="v2-process-ready-overlay" onClick={onClose} />
      )}

      {/* ============================================================ */}
      {/* 슬라이드 모달 */}
      {/* ============================================================ */}
      <div className={`v2-process-ready-modal ${isOpen ? 'open' : ''}`}>
        {/* 헤더 */}
        <div className="v2-process-ready-header">
          <h2>처리준비목록</h2>
          <button className="v2-pr-close-button" onClick={onClose}>✕</button>
        </div>

        {/* 컨텐츠 */}
        <div className="v2-process-ready-content">
          {readyItems.length === 0 ? (
            <div className="v2-pr-empty-message">수정된 항목이 없습니다.</div>
          ) : (
            <div className="v2-ready-items-list">
              {readyItems.map(({ item, import_qty }) => (
                <div key={item.id} className="v2-ready-item">
                  {/* 이미지 */}
                  <div className="v2-ready-item-image">
                    {item.img_url ? (
                      <img
                        src={`/api/image-proxy?url=${encodeURIComponent(item.img_url)}`}
                        alt="상품 이미지"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/placeholder.svg';
                        }}
                      />
                    ) : (
                      <div className="v2-pr-no-image">이미지 없음</div>
                    )}
                  </div>

                  {/* 상품 정보 */}
                  <div className="v2-ready-item-info">
                    {/* 글번호 행: [사이즈 배지] [item_no 회색 배지] | [barcode] | (P+PDF) 운송장 번호
                         줄바꿈 없이 한 줄에 모두 표시 */}
                    <div className="v2-pr-order-barcode-row">
                      {(() => {
                        const sizeBadge = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
                        return sizeBadge ? (
                          <span className={`size-badge ${sizeBadge.colorClass}`}>{sizeBadge.code}</span>
                        ) : null;
                      })()}
                      {item.item_no && (
                        <span className="v2-pr-item-no-badge">{item.item_no}</span>
                      )}
                      {item.barcode && (
                        <>
                          <span className="v2-pr-separator">|</span>
                          <span>{item.barcode}</span>
                        </>
                      )}
                      {/* P(PERSONAL) + PDF 존재 시 운송장 번호 인라인 표시 (주황) */}
                      {item.shipment_type?.trim().toUpperCase() === 'PERSONAL'
                        && item.personal_order_no
                        && invoicePdfSet?.has(item.personal_order_no) && (
                        <>
                          <span className="v2-pr-separator">|</span>
                          <span className="v2-pr-personal-order-no-inline">
                            {item.personal_order_no}
                          </span>
                        </>
                      )}
                    </div>

                    {/* 상품명 */}
                    <div className="v2-pr-product-name">
                      {item.item_name || ''}
                      {item.option_name && ` ${item.option_name}`}
                    </div>

                    {/* 주문옵션 배지 */}
                    {(item.china_option1 || item.china_option2) && (
                      <div className="v2-pr-order-option-badge">
                        {item.china_option1 || ''}{item.china_option2 ? ` ${item.china_option2}` : ''}
                      </div>
                    )}

                    {/* 진행 / 입고 */}
                    <div className="v2-pr-stats-row">
                      <div className="v2-pr-stat-item">
                        <span className="v2-pr-stat-label">진행</span>
                        <span className={`v2-pr-stat-value ${(item.order_qty || 0) === 0 ? 'zero' : ''}`}>
                          {item.order_qty || 0}
                        </span>
                      </div>
                      <div className="v2-pr-stat-item">
                        <span className="v2-pr-stat-label">입고</span>
                        <span className={`v2-pr-stat-value import ${import_qty === 0 ? 'zero' : ''}`}>
                          {import_qty}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="v2-process-ready-footer">
          <div className="v2-pr-footer-info">총 {readyItems.length}개</div>
          <div className="v2-pr-save-buttons-row">
            <button
              className="v2-pr-save-button v2-pr-save-postgre"
              disabled={readyItems.length === 0 || isSaving || isSaved}
              onClick={handleSavePostgre}
            >
              {isSaving ? (
                <span className="v2-pr-button-loading">
                  <span className="v2-pr-spinner"></span>
                  저장 중...
                </span>
              ) : isSaved ? (
                '저장 완료'
              ) : (
                'postgre + 저장'
              )}
            </button>
            {/* [송장 출력] 버튼 — P 상품 PDF 병합 인쇄 */}
            {onPrintInvoices && (
              <button
                className="v2-pr-save-button v2-pr-save-invoice"
                disabled={!invoicePrintable || isPrintingInvoices}
                onClick={handlePrintInvoices}
              >
                {isPrintingInvoices ? (
                  <span className="v2-pr-button-loading">
                    <span className="v2-pr-spinner"></span>
                    {t('importProduct.processReady.printInvoices')}
                  </span>
                ) : (
                  t('importProduct.processReady.printInvoices')
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default V2ReadyModal;
