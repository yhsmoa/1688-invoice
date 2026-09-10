'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import type { LabelType } from '../../../lib/labelTypes';
import type { AudienceTemplates, PrintLabelResult } from '../utils/printLabels';
import { useLabelTemplatePlan } from '../hooks/useLabelTemplatePlan';
import LabelTemplatePicker from './LabelTemplatePicker';
import './V2ReadyModal.css';

// ============================================================
// V2 처리준비 모달 - 수정된 입고 데이터 리스트 표시
//
// "postgre + 저장" / "송장 출력" — 기존 버튼. 이전부터 쓰던 사용자를 위해
//   그대로 유지한다 (동작 변경 없음).
//
// [저장] [라벨 스티커] [케어 라벨] [모두] — 새 버튼 행.
//   저장          : postgre + 저장 과 완전히 같은 동작 (같은 핸들러 공유)
//   라벨 스티커    : 바코드 감열지 즉시 출력 (QZ Tray)
//   케어 라벨      : 케어라벨 즉시 출력 (QZ Tray)
//   모두          : 저장(안 됐으면) → 라벨 스티커 → 케어 라벨 순서로 진행.
//                   중간 단계가 실패하면 알림만 띄우고 멈춘다 (다음 단계로 넘어가지 않음).
//
// 템플릿 선택 (LabelTemplatePicker + useLabelTemplatePlan)
//   출력 버튼 위에 종류별로 "어떤 템플릿으로 찍는지" 를 보여주고 드롭다운으로 바꿀 수 있다.
//   권장연령 있는 상품 → 키즈, 없는 상품 → 성인 템플릿이 자동 선택된다.
//   필요한 대상에 템플릿이 없으면 그 종류의 출력 버튼은 잠기고 드롭다운에 "없음" 이 뜬다.
// ============================================================

/** 출력 성공 표시(플래시) 유지 시간 */
const PRINT_FLASH_MS = 3000;

export interface V2ReadyItem {
  item: FtOrderItem;
  import_qty: number;
}

interface V2ReadyModalProps {
  isOpen: boolean;
  onClose: () => void;
  readyItems: V2ReadyItem[];
  /**
   * postgre + 저장 핸들러 (ItemCheck에서 전달).
   * 성공하면 true, 실패하면 false — 실패 시 알림은 이 함수 안에서 띄운다.
   * [모두] 버튼이 다음 단계(출력) 진행 여부를 이 반환값으로 판단한다.
   */
  onSavePostgre: () => Promise<boolean>;
  /**
   * 라벨 즉시 출력 핸들러 (ItemCheck에서 전달) — readyItems 를 QZ Tray 로 인쇄한다.
   * templates 는 이 모달의 드롭다운에서 확정된 대상별 템플릿.
   * 실패해도 예외를 던지지 않고 result.success = false 로 알려준다.
   */
  onPrintLabel: (labelType: LabelType, templates: AudienceTemplates) => Promise<PrintLabelResult>;
  /** 템플릿 조회 범위 — 선택된 사업자 (공용 + 그 사업자 전용) */
  selectedUserId: string | null;
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
  onPrintLabel,
  selectedUserId,
  onPrintInvoices,
  invoicePrintable = false,
  isSaved = false,
  invoicePdfSet,
}) => {
  const { t } = useTranslation();

  // ============================================================
  // 템플릿 선택 계획 — 바코드 있는 항목만 인쇄 대상이므로 그 기준으로 대상을 나눈다
  // ============================================================
  const printableItems = useMemo(
    () => readyItems.filter(({ item }) => item.barcode).map(({ item }) => item),
    [readyItems]
  );
  const plan = useLabelTemplatePlan({ active: isOpen, userId: selectedUserId, items: printableItems });
  const barcodeMissing = plan.missingOf('barcode').length > 0;
  const careMissing = plan.missingOf('care').length > 0;

  // ============================================================
  // 저장 / 인쇄 로딩 상태
  // ============================================================
  const [isSaving, setIsSaving] = useState(false);
  const [isPrintingInvoices, setIsPrintingInvoices] = useState(false);
  const [isPrintingBarcode, setIsPrintingBarcode] = useState(false);
  const [isPrintingCare, setIsPrintingCare] = useState(false);
  const [isRunningAll, setIsRunningAll] = useState(false);

  /** 출력 성공 플래시 ("N장 전송됨") — 종류별로 따로 표시 */
  const [barcodeFlash, setBarcodeFlash] = useState<string | null>(null);
  const [careFlash, setCareFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!barcodeFlash) return;
    const timer = setTimeout(() => setBarcodeFlash(null), PRINT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [barcodeFlash]);

  useEffect(() => {
    if (!careFlash) return;
    const timer = setTimeout(() => setCareFlash(null), PRINT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [careFlash]);

  /** 바코드가 있는 항목이 하나도 없으면 라벨 출력 버튼들을 비활성화 */
  const hasPrintableItems = readyItems.some(({ item }) => item.barcode);
  /** 새/기존 저장·출력 버튼이 하나라도 동작 중이면 전부 잠근다 (동시 실행 방지) */
  const isBusy = isSaving || isPrintingInvoices || isPrintingBarcode || isPrintingCare || isRunningAll;

  // ============================================================
  // postgre + 저장 클릭 핸들러 — [postgre + 저장] [저장] 버튼 공용
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

  // ============================================================
  // 라벨 스티커 / 케어 라벨 — 종류 하나 출력 (성공 시 flash, 실패 시 알림)
  // 반환값은 [모두] 버튼이 다음 단계 진행 여부를 판단하는 데 쓴다.
  // ============================================================
  const printOne = async (labelType: LabelType): Promise<boolean> => {
    const setBusy = labelType === 'barcode' ? setIsPrintingBarcode : setIsPrintingCare;
    const setFlash = labelType === 'barcode' ? setBarcodeFlash : setCareFlash;
    const typeLabel = t(
      labelType === 'barcode'
        ? 'importProduct.processReady.labelSticker'
        : 'importProduct.processReady.careLabel'
    );

    setBusy(true);
    try {
      const result = await onPrintLabel(labelType, plan.selectedOf(labelType));
      if (result.success) {
        setFlash(`${typeLabel} ${t('importProduct.processReady.printedCount', { count: result.printed })}`);
        return true;
      }
      alert(result.error || t('importProduct.processReady.printing'));
      return false;
    } catch (error) {
      console.error('라벨 출력 오류:', error);
      alert('라벨 출력 중 오류가 발생했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ============================================================
  // [모두] — 저장(안 됐으면) → 라벨 스티커 → 케어 라벨, 순서대로.
  // 한 단계라도 실패하면 그 단계에서 알림만 띄우고 다음 단계로 넘어가지 않는다.
  // ============================================================
  const handleRunAll = async () => {
    setIsRunningAll(true);
    try {
      if (!isSaved) {
        setIsSaving(true);
        const saveOk = await onSavePostgre();
        setIsSaving(false);
        if (!saveOk) return;
      }
      if (!(await printOne('barcode'))) return;
      await printOne('care');
    } finally {
      setIsRunningAll(false);
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

          {/* 기존 버튼 — 이전부터 쓰던 사용자를 위해 동작 그대로 유지 */}
          <div className="v2-pr-save-buttons-row">
            <button
              className="v2-pr-save-button v2-pr-save-postgre"
              disabled={readyItems.length === 0 || isBusy || isSaved}
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
                disabled={!invoicePrintable || isBusy}
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

          {/* 새 버튼 — 저장 / 종류별 즉시 출력 / 모두 순서대로 */}
          <div className="v2-pr-quick-actions-row">
            {/* 어떤 템플릿으로 찍는지 — 종류별 · 대상(성인/키즈)별, 드롭다운으로 변경 가능 */}
            {hasPrintableItems && (
              <div className="v2-pr-template-plan">
                <LabelTemplatePicker
                  plan={plan}
                  labelType="barcode"
                  title={t('importProduct.processReady.labelSticker')}
                  disabled={isBusy}
                />
                <LabelTemplatePicker
                  plan={plan}
                  labelType="care"
                  title={t('importProduct.processReady.careLabel')}
                  disabled={isBusy}
                />
                <div className="v2-pr-template-hint">{t('importProduct.processReady.templateHint')}</div>
              </div>
            )}

            {(barcodeFlash || careFlash) && (
              <div className="v2-pr-flash-row">
                {barcodeFlash && <span className="v2-pr-flash">✓ {barcodeFlash}</span>}
                {careFlash && <span className="v2-pr-flash">✓ {careFlash}</span>}
              </div>
            )}
            <div className="v2-pr-quick-buttons-row">
              <button
                className="v2-pr-quick-button v2-pr-quick-save"
                disabled={readyItems.length === 0 || isBusy || isSaved}
                onClick={handleSavePostgre}
              >
                {isSaving && !isRunningAll ? (
                  <span className="v2-pr-button-loading">
                    <span className="v2-pr-spinner"></span>
                    {t('importProduct.processReady.saving')}
                  </span>
                ) : isSaved ? (
                  t('importProduct.processReady.saved')
                ) : (
                  t('importProduct.processReady.save')
                )}
              </button>

              <button
                className="v2-pr-quick-button v2-pr-quick-print"
                disabled={!hasPrintableItems || isBusy || plan.loading || barcodeMissing}
                onClick={() => printOne('barcode')}
              >
                {isPrintingBarcode && !isRunningAll ? (
                  <span className="v2-pr-button-loading">
                    <span className="v2-pr-spinner"></span>
                    {t('importProduct.processReady.printing')}
                  </span>
                ) : (
                  t('importProduct.processReady.labelSticker')
                )}
              </button>

              <button
                className="v2-pr-quick-button v2-pr-quick-print"
                disabled={!hasPrintableItems || isBusy || plan.loading || careMissing}
                onClick={() => printOne('care')}
              >
                {isPrintingCare && !isRunningAll ? (
                  <span className="v2-pr-button-loading">
                    <span className="v2-pr-spinner"></span>
                    {t('importProduct.processReady.printing')}
                  </span>
                ) : (
                  t('importProduct.processReady.careLabel')
                )}
              </button>

              <button
                className="v2-pr-quick-button v2-pr-quick-all"
                disabled={!hasPrintableItems || isBusy || plan.loading || barcodeMissing || careMissing}
                onClick={handleRunAll}
              >
                {isRunningAll ? (
                  <span className="v2-pr-button-loading">
                    <span className="v2-pr-spinner"></span>
                    {t('importProduct.processReady.all')}
                  </span>
                ) : (
                  t('importProduct.processReady.all')
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default V2ReadyModal;
