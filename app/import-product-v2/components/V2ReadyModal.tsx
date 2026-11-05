'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge } from '../../../lib/sizeCode';
import type { LabelType } from '../../../lib/labelTypes';
import { mergeSetEntries, type AudienceTemplates, type PrintLabelResult } from '../utils/printLabels';
import { useLabelTemplatePlan } from '../hooks/useLabelTemplatePlan';
import LabelTemplatePicker from './LabelTemplatePicker';
import HelpTip from '../../../component/HelpTip';
import { getSetGroupKey } from '../utils/setGroupPalette';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import './V2ReadyModal.css';

// ============================================================
// V2 처리준비 모달 — 작업 수량을 입력한 항목 목록 + 저장·출력
//
// 항목 카드 오른쪽에 "입고 / 진행" 을 크게 보여준다.
//   입고(import_qty) 가 진행(progress_qty, 테이블 '진행' 공식) 과 같으면 초록, 다르면 주황.
//
// 목록
//   · 세트 구성품은 그룹 순서로 붙어 오고(ItemCheck readyItems), 세트 배지 + 왼쪽 묶음선으로 묶어 보인다
//   · 한국어 상품명은 'kr' 칩에 접어 두고 hover 로 본다
//   · 실제로 출력될 라벨 스티커·케어 라벨 장수는 푸터의 템플릿 제목 옆 칩 (스크롤 없이 보이게,
//     printLabels 의 세트 병합 규칙과 동일)
//
// 푸터 (위 → 아래 = 작업 순서)
//   1. 라벨 템플릿   : 종류별·대상(성인/키즈)별로 어떤 템플릿으로 찍는지 확인·변경 (LabelTemplatePicker)
//                      자동 선택 규칙은 제목 옆 ? 칩
//   2. [모두]        : 저장(안 됐으면) → 라벨 스티커 → 케어 라벨. 중간 실패 시 알림만 띄우고 멈춘다.
//                      케어 라벨은 PERSONAL(P) 상품을 찍지 않는다 — P 만 있으면 케어 단계는 건너뛴다
//      [저장] [라벨 스티커] [케어 라벨] : 한 단계씩 따로 실행 (케어 라벨도 P 제외)
//      [송장 출력]   : P 상품 운송장 PDF 병합 인쇄 — 당분간 숨김 (SHOW_INVOICE_PRINT)
//
// ※ 예전 [postgre + 저장] 버튼은 [저장] 과 같은 핸들러라 하나로 합쳤다 (동작 변경 없음).
// ============================================================

/** 출력 성공 표시(플래시) 유지 시간 */
const PRINT_FLASH_MS = 3000;

/** [송장 출력] 버튼 노출 — 사용자 요청으로 당분간 숨김 (핸들러·조회 로직은 유지) */
const SHOW_INVOICE_PRINT = false;

/** 라벨 출력 옵션 — 케어 라벨은 PERSONAL(P) 상품 제외 */
export interface PrintOptions {
  excludePersonal?: boolean;
}

const isPersonal = (item: FtOrderItem) => item.shipment_type?.trim().toUpperCase() === 'PERSONAL';
const CARE_OPTIONS: PrintOptions = { excludePersonal: true };

export interface V2ReadyItem {
  item: FtOrderItem;
  import_qty: number;
  /** 테이블 '진행' 과 같은 값 — order_qty - CANCEL - RETURN - 출고완료 */
  progress_qty: number;
}

interface V2ReadyModalProps {
  isOpen: boolean;
  onClose: () => void;
  readyItems: V2ReadyItem[];
  /**
   * 저장 핸들러 (ItemCheck에서 전달).
   * 성공하면 true, 실패하면 false — 실패 시 알림은 이 함수 안에서 띄운다.
   * [모두] 버튼이 다음 단계(출력) 진행 여부를 이 반환값으로 판단한다.
   */
  onSavePostgre: () => Promise<boolean>;
  /**
   * 라벨 즉시 출력 핸들러 (ItemCheck에서 전달) — readyItems 를 QZ Tray 로 인쇄한다.
   * templates 는 이 모달의 드롭다운에서 확정된 대상별 템플릿.
   * 실패해도 예외를 던지지 않고 result.success = false 로 알려준다.
   */
  onPrintLabel: (labelType: LabelType, templates: AudienceTemplates, options?: PrintOptions) => Promise<PrintLabelResult>;
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

// ── 버튼 아이콘 ──
const ICON = {
  save: 'M5 3h11l3 3v15H5zM8 3v5h7M8 21v-7h8v7',
  label: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  care: 'M7 3h10v18l-5-3-5 3z',
  invoice: 'M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L19 7',
} as const;

const Icon: React.FC<{ name: keyof typeof ICON; size?: number }> = ({ name, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d={ICON[name]} />
  </svg>
);

/** 버튼 안 로딩 표시 */
const Busy: React.FC<{ label: string }> = ({ label }) => (
  <span className="v2-pr-button-loading">
    <span className="v2-pr-spinner"></span>
    {label}
  </span>
);

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
  // 출력될 장수 — printLabels 와 같은 규칙 (바코드 있는 항목, 세트는 1벌 1장으로 병합)
  //   케어 라벨은 PERSONAL(P) 상품 제외
  // ============================================================
  const { stickerTotal, careTotal } = useMemo(() => {
    const entries = readyItems
      .filter(({ item }) => item.barcode)
      .map(({ item, import_qty }) => ({ item, qty: import_qty }));
    const sum = (list: typeof entries) => mergeSetEntries(list).reduce((n, e) => n + e.qty, 0);
    return {
      stickerTotal: sum(entries),
      careTotal: sum(entries.filter(({ item }) => !isPersonal(item))),
    };
  }, [readyItems]);

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
  /** 저장·출력 버튼이 하나라도 동작 중이면 전부 잠근다 (동시 실행 방지) */
  const isBusy = isSaving || isPrintingInvoices || isPrintingBarcode || isPrintingCare || isRunningAll;

  // ============================================================
  // 저장 클릭 핸들러
  // ============================================================
  const handleSave = async () => {
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
  const printOne = async (labelType: LabelType, options?: PrintOptions): Promise<boolean> => {
    const setBusy = labelType === 'barcode' ? setIsPrintingBarcode : setIsPrintingCare;
    const setFlash = labelType === 'barcode' ? setBarcodeFlash : setCareFlash;
    const typeLabel = t(
      labelType === 'barcode'
        ? 'importProduct.processReady.labelSticker'
        : 'importProduct.processReady.careLabel'
    );

    setBusy(true);
    try {
      const result = await onPrintLabel(labelType, plan.selectedOf(labelType), options);
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
  // 케어 라벨은 PERSONAL(P) 제외 — 찍을 게 없으면(P 만 있으면) 그 단계는 건너뛴다.
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
      if (careTotal > 0) await printOne('care', CARE_OPTIONS);
    } finally {
      setIsRunningAll(false);
    }
  };

  const saveLabel = isSaved
    ? t('importProduct.processReady.saved')
    : t('importProduct.processReady.save');

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
      <div className={`v2-process-ready-modal ${isOpen ? 'open' : ''}`} role="dialog" aria-modal="true">
        {/* ── 헤더 ── */}
        <div className="v2-process-ready-header">
          <div className="v2-pr-title-wrap">
            <h2>{t('importProduct.processReady.modalTitle')}</h2>
            <span className="v2-pr-count">
              {t('importProduct.processReady.totalItems')} {readyItems.length}{t('importProduct.processReady.itemsCount')}
            </span>
          </div>
          <button className="v2-pr-close-button" onClick={onClose} type="button" aria-label="close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* ── 항목 목록 ── */}
        <div className="v2-process-ready-content">
          {readyItems.length === 0 ? (
            <div className="v2-pr-empty-message">{t('importProduct.processReady.emptyMessage')}</div>
          ) : (
            <div className="v2-ready-items-list">
              {readyItems.map(({ item, import_qty, progress_qty }, idx) => {
                const sizeBadge = resolveSizeBadge(item.shipment_type, item.coupang_shipment_size);
                // 세트 묶음 — 앞뒤 항목과 같은 세트면 묶음선을 잇는다 (ItemTable 과 같은 first/mid/last/only)
                const setKey = getSetGroupKey(item);
                const prevKey = idx > 0 ? getSetGroupKey(readyItems[idx - 1].item) : null;
                const nextKey = idx < readyItems.length - 1 ? getSetGroupKey(readyItems[idx + 1].item) : null;
                const setPos =
                  setKey === null ? ''
                  : prevKey === setKey && nextKey === setKey ? 'mid'
                  : nextKey === setKey ? 'first'
                  : prevKey === setKey ? 'last'
                  : 'only';
                const krName = [item.item_name, item.option_name].filter(Boolean).join(' ');
                const showPersonalNo =
                  item.shipment_type?.trim().toUpperCase() === 'PERSONAL'
                  && !!item.personal_order_no
                  && !!invoicePdfSet?.has(item.personal_order_no);
                // 입고 = 진행 이면 초록(다 들어옴), 아니면 주황(덜 들어옴 / 초과)
                const qtyTone = import_qty === progress_qty ? 'is-match' : 'is-diff';

                return (
                  <div key={item.id} className={`v2-ready-item ${setKey ? `is-set v2-pr-set-${setPos}` : ''}`}>
                    {/* 이미지 */}
                    <div className="v2-ready-item-image">
                      {item.img_url ? (
                        <img
                          src={proxyImageUrl(item.img_url, THUMB_WIDTH)}
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
                      {/* 글번호 행: [사이즈 배지] [item_no 배지] [barcode] — 한 줄 */}
                      <div className="v2-pr-order-barcode-row">
                        {sizeBadge && (
                          <span className={`size-badge ${sizeBadge.colorClass}`}>{sizeBadge.code}</span>
                        )}
                        {setKey && (
                          <span className="v2-set-badge">
                            {t('importProduct.processReady.setOf', { total: item.set_total, seq: item.set_seq ?? '?' })}
                          </span>
                        )}
                        {item.item_no && (
                          <span className="v2-pr-item-no-badge">{item.item_no}</span>
                        )}
                        {item.barcode && (
                          <span className="v2-pr-barcode">{item.barcode}</span>
                        )}
                        {/* 한국어 상품명 — 'kr' 칩에 접어 두고 hover 로 본다 */}
                        {krName && (
                          <HelpTip
                            variant="text"
                            label="kr"
                            placement="bottom"
                            className="v2-pr-kr"
                            text={`${t('importProduct.processReady.krTip')}\n${krName}`}
                          />
                        )}
                      </div>

                      {/* P(PERSONAL) + PDF 존재 시 운송장 번호 (주황) */}
                      {showPersonalNo && (
                        <div className="v2-pr-personal-order-no-inline">↳ {item.personal_order_no}</div>
                      )}

                      {/* 주문옵션 배지 */}
                      {(item.china_option1 || item.china_option2) && (
                        <div className="v2-pr-order-option-badge">
                          {item.china_option1 || ''}{item.china_option2 ? ` ${item.china_option2}` : ''}
                        </div>
                      )}
                    </div>

                    {/* 입고 / 진행 — 같으면 초록, 다르면 주황 */}
                    <div className={`v2-pr-qty ${qtyTone}`}>
                      <span className="v2-pr-qty-label">{t('importProduct.processReady.importOverProgress')}</span>
                      <span className="v2-pr-qty-value">
                        {import_qty}
                        <span className="v2-pr-qty-sep">/</span>
                        {progress_qty}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* 푸터 — 템플릿 확인 → 실행 */}
        {/* ============================================================ */}
        <div className="v2-process-ready-footer">
          {/* 1. 라벨 템플릿 — 종류별 · 대상(성인/키즈)별, 드롭다운으로 변경 가능 */}
          {hasPrintableItems && (
            <section className="v2-pr-template-plan" aria-label={t('importProduct.processReady.templateTitle')}>
              <div className="v2-pr-template-head">
                <h3>{t('importProduct.processReady.templateTitle')}</h3>
              </div>
              <LabelTemplatePicker
                plan={plan}
                labelType="barcode"
                title={t('importProduct.processReady.labelSticker')}
                badge={t('importProduct.processReady.sheets', { count: stickerTotal })}
                badgeActive={stickerTotal > 0}
                help={t('importProduct.processReady.templateHint')}
                disabled={isBusy}
              />
              <LabelTemplatePicker
                plan={plan}
                labelType="care"
                title={t('importProduct.processReady.careLabel')}
                badge={t('importProduct.processReady.sheets', { count: careTotal })}
                badgeActive={careTotal > 0}
                help={t('importProduct.processReady.templateHint')}
                disabled={isBusy}
              />
            </section>
          )}

          {/* 출력 성공 플래시 — alert 대신 잠깐 표시 */}
          {(barcodeFlash || careFlash) && (
            <div className="v2-pr-flash-row" role="status">
              {barcodeFlash && <span className="v2-pr-flash"><Icon name="check" size={14} />{barcodeFlash}</span>}
              {careFlash && <span className="v2-pr-flash"><Icon name="check" size={14} />{careFlash}</span>}
            </div>
          )}

          {/* 2. 실행 — [모두] 가 대표, 아래 세 버튼은 한 단계씩 */}
          <div className="v2-pr-actions">
            {/* [모두] — 케어 템플릿은 케어를 찍을 항목(P 제외)이 있을 때만 필요 */}
            <div className="v2-pr-all-row">
              <button
                type="button"
                className="v2-pr-all-button"
                disabled={!hasPrintableItems || isBusy || plan.loading || barcodeMissing || (careTotal > 0 && careMissing)}
                onClick={handleRunAll}
              >
                {isRunningAll ? (
                  <Busy label={t('importProduct.processReady.all')} />
                ) : (
                  <>
                    <span className="v2-pr-all-title">{t('importProduct.processReady.all')}</span>
                    <span className="v2-pr-all-hint">{t('importProduct.processReady.allHint')}</span>
                  </>
                )}
              </button>
              <HelpTip text={t('importProduct.processReady.allHelp')} className="v2-pr-all-help" />
            </div>

            <div className="v2-pr-step-buttons">
              <button
                type="button"
                className="v2-pr-step-button"
                disabled={readyItems.length === 0 || isBusy || isSaved}
                onClick={handleSave}
              >
                {isSaving && !isRunningAll ? (
                  <Busy label={t('importProduct.processReady.saving')} />
                ) : (
                  <><Icon name="save" />{saveLabel}</>
                )}
              </button>

              <button
                type="button"
                className="v2-pr-step-button"
                disabled={!hasPrintableItems || isBusy || plan.loading || barcodeMissing}
                onClick={() => printOne('barcode')}
              >
                {isPrintingBarcode && !isRunningAll ? (
                  <Busy label={t('importProduct.processReady.printing')} />
                ) : (
                  <><Icon name="label" />{t('importProduct.processReady.labelSticker')}</>
                )}
              </button>

              <button
                type="button"
                className="v2-pr-step-button"
                disabled={careTotal === 0 || isBusy || plan.loading || careMissing}
                onClick={() => printOne('care', CARE_OPTIONS)}
              >
                {isPrintingCare && !isRunningAll ? (
                  <Busy label={t('importProduct.processReady.printing')} />
                ) : (
                  <><Icon name="care" />{t('importProduct.processReady.careLabel')}</>
                )}
              </button>
            </div>

            {/* 송장 출력 — P 상품 PDF 병합 인쇄 (당분간 숨김) */}
            {SHOW_INVOICE_PRINT && onPrintInvoices && (
              <button
                type="button"
                className="v2-pr-invoice-button"
                disabled={!invoicePrintable || isBusy}
                onClick={handlePrintInvoices}
              >
                {isPrintingInvoices ? (
                  <Busy label={t('importProduct.processReady.printInvoices')} />
                ) : (
                  <>
                    <Icon name="invoice" />
                    {t('importProduct.processReady.printInvoices')}
                    <span className="v2-pr-invoice-hint">· {t('importProduct.processReady.invoiceHint')}</span>
                  </>
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
