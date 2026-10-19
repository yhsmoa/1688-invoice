'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { useLabelTemplatePlan } from '../../import-product-v2/hooks/useLabelTemplatePlan';
import LabelTemplatePicker from '../../import-product-v2/components/LabelTemplatePicker';
import type { AudienceTemplates, PrintLabelResult } from '../../import-product-v2/utils/printLabels';
import type { LabelType } from '../../../lib/labelTypes';
import OptionList from './OptionList';
import OrderRowTable, { type RowMaps } from './OrderRowTable';
import StickerPlanPopover from './StickerPlanPopover';
import { useAllocationBatch } from '../hooks/useAllocationBatch';
import { useStickerPlan } from '../hooks/useStickerPlan';
import { useV3Print } from '../hooks/useV3Print';
import { optionIdOf, type Board, type Card, type OptionGroup } from '../utils/buildBoards';
import { remainingOf, setInstanceKeyOf, EMPTY_OPT } from '../utils/groupKeys';
import { distribute } from '../utils/distribute';
import { planCareLabels } from '../utils/stickerPlan';
import './CardModal.css';

// ============================================================
// 상품입고 V3 — 카드(보드) 모달
//
//   ┌ 헤더: 상품명 · 오퍼 링크 · [반품] [비고] [고객확인] [운송장] · ✕ ┐
//   │ 왼쪽: 구성품별 옵션 + 개수 입력 │ 오른쪽: 선택 옵션의 주문행 표     │
//   └ 푸터: 요약 · 템플릿 · [저장] [라벨 스티커] [케어 라벨] [모두]     ┘
//
// 흐름
//   옵션에 개수 입력 → 주문행 순서대로 배분(utils/distribute) → 배치(useAllocationBatch)
//   [저장] → 페이지 onSave (ARRIVAL + BarTender 라벨) → 배치 'saved'
//   [라벨 스티커] → 출력 직전 최신 계산(useStickerPlan.buildFresh) → 세트는 1벌 1장
//   다른 옵션을 이어서 입력하면 새 배치가 자동으로 시작된다.
// ============================================================

/** 안내 문구 유지 시간 */
const NOTICE_MS = 2500;

interface CardModalProps {
  /** null 이면 닫힘 */
  board: Board | null;
  /** product_id → 세트 구성품 (검색 결과 밖 형제 포함) */
  partsByProductId: Map<string, FtOrderItem[]>;
  maps: RowMaps;
  selectedUserId: string;
  // ── P 운송장 ──
  invoicePdfSet: Set<string>;
  isItemInvoicePrintable: (item: FtOrderItem) => boolean;
  onPrintInvoices: (items: FtOrderItem[]) => Promise<void> | void;
  // ── 저장 / 출력 ──
  onSave: (alloc: Map<string, number>, rowsById: Map<string, FtOrderItem>) => Promise<boolean>;
  onPrintLabel: (
    rows: { item: FtOrderItem; qty: number }[],
    labelType: LabelType,
    templates: AudienceTemplates
  ) => Promise<PrintLabelResult>;
  // ── 부가 모달 (페이지가 띄운다 — 이 모달 위에 겹쳐 뜸) ──
  onOpenCancel: (items: FtOrderItem[]) => void;
  onOpenNote: (items: FtOrderItem[]) => void;
  onOpenCustomerConfirm: (items: FtOrderItem[]) => void;
  onOpenLog: (item: FtOrderItem) => void;
  onClose: () => void;
}

/** 보드에서 옵션 id → (카드, 옵션) */
function indexOptions(board: Board | null): Map<string, { card: Card; opt: OptionGroup }> {
  const map = new Map<string, { card: Card; opt: OptionGroup }>();
  if (!board) return map;
  for (const card of board.cards) for (const opt of card.options) map.set(optionIdOf(card.key, opt.key), { card, opt });
  return map;
}

const CardModal: React.FC<CardModalProps> = ({
  board,
  partsByProductId,
  maps,
  selectedUserId,
  invoicePdfSet,
  isItemInvoicePrintable,
  onPrintInvoices,
  onSave,
  onPrintLabel,
  onOpenCancel,
  onOpenNote,
  onOpenCustomerConfirm,
  onOpenLog,
  onClose,
}) => {
  const { t } = useTranslation();
  const isOpen = board !== null;

  // ============================================================
  // 상태 — 배치 / 선택 옵션 / 체크된 행 / 안내 문구
  // ============================================================
  const batch = useAllocationBatch();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [showStickerPlan, setShowStickerPlan] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // ── 다른 보드를 열면 초기화 + 첫 작업 가능 옵션 선택 ──
  const boardKey = board?.key ?? null;
  const optionIndex = useMemo(() => indexOptions(board), [board]);
  useEffect(() => {
    batch.reset();
    setSelectedIds(new Set());
    setShowStickerPlan(false);
    setNotice(null);
    if (!board) {
      setSelectedOptionId(null);
      return;
    }
    const first =
      board.cards.flatMap((c) => c.options.map((o) => ({ c, o }))).find(({ o }) => o.remainingTotal > 0) ??
      board.cards.flatMap((c) => c.options.map((o) => ({ c, o })))[0];
    setSelectedOptionId(first ? optionIdOf(first.c.key, first.o.key) : null);
    // board 객체는 refresh 마다 새로 만들어지므로 key 변화에만 반응한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  // ============================================================
  // 파생 데이터
  // ============================================================
  const rowsById = useMemo(() => new Map((board?.rows ?? []).map((r) => [r.id, r])), [board]);

  // 보드의 세트 product_id → 구성품 전체 / 이 배송에 없는 구성품
  const { partIds, externalParts } = useMemo(() => {
    const productIds = new Set((board?.rows ?? []).map(setInstanceKeyOf).filter((v): v is string => v !== null));
    const ids: string[] = [];
    const external: FtOrderItem[] = [];
    for (const pid of productIds) {
      for (const p of partsByProductId.get(pid) ?? []) {
        ids.push(p.id);
        if (!rowsById.has(p.id)) external.push(p);
      }
    }
    return { partIds: ids, externalParts: external };
  }, [board, partsByProductId, rowsById]);

  const selected = selectedOptionId ? optionIndex.get(selectedOptionId) ?? null : null;

  // ============================================================
  // 라벨 템플릿 — 배분된 바코드 행 기준 (없으면 보드 전체 기준으로 미리 보여줌)
  // ============================================================
  const templateItems = useMemo(() => {
    const allocRows = Array.from(batch.alloc.keys())
      .map((id) => rowsById.get(id))
      .filter((r): r is FtOrderItem => !!r && !!r.barcode);
    return allocRows.length > 0 ? allocRows : (board?.rows ?? []).filter((r) => r.barcode);
  }, [batch.alloc, rowsById, board]);
  const templatePlan = useLabelTemplatePlan({ active: isOpen, userId: selectedUserId || null, items: templateItems });
  const barcodeMissing = templatePlan.missingOf('barcode').length > 0;
  const careMissing = templatePlan.missingOf('care').length > 0;

  // ============================================================
  // 세트 스티커 계획 + 저장/출력
  // ============================================================
  const sticker = useStickerPlan({
    isOpen,
    alloc: batch.alloc,
    status: batch.status,
    rowsById,
    partsByProductId,
    arrivalMap: maps.arrivalMap,
    cancelMap: maps.cancelMap,
    partIds,
  });

  const handleSave = useCallback(async () => {
    const ok = await onSave(batch.alloc, rowsById);
    if (ok) batch.markSaved();
    return ok;
  }, [onSave, batch, rowsById]);

  const print = useV3Print({
    alloc: batch.alloc,
    status: batch.status,
    rowsById,
    onSave: handleSave,
    sticker,
    templatePlan,
    onPrintLabel,
    t,
  });

  // ============================================================
  // 한 배치 = 옵션 하나 — 화이트 120 → [모두] → 블랙 120 → [모두] → 화이트 130 …
  //   저장 안 한 입력이 있는 옵션(색상+사이즈)이 있으면 다른 옵션 입력은 거부한다
  //   (같은 색상의 다른 사이즈도). 케어라벨·세트 스티커가 옵션 하나 단위로 나와 섞이지 않는다.
  //   그 옵션을 [모두]/[저장]으로 끝내면(status 'saved') 잠금이 풀린다.
  // ============================================================
  const cardKeyByRowId = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of board?.cards ?? []) for (const r of card.rows) map.set(r.id, card.key);
    return map;
  }, [board]);

  const optionIdByRowId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, { opt }] of optionIndex) for (const r of opt.rows) map.set(r.id, id);
    return map;
  }, [optionIndex]);

  const lockedOptionId = useMemo(() => {
    if (batch.status !== 'editing') return null;
    for (const [id, qty] of batch.alloc) {
      if (qty > 0) return optionIdByRowId.get(id) ?? null;
    }
    return null;
  }, [batch.status, batch.alloc, optionIdByRowId]);

  /** 다른 옵션 입력이면 안내 후 true */
  const rejectOtherOption = useCallback(
    (optionId: string | undefined): boolean => {
      if (!lockedOptionId || !optionId || optionId === lockedOptionId) return false;
      const locked = optionIndex.get(lockedOptionId);
      const color = locked && locked.card.color !== EMPTY_OPT ? locked.card.color : '';
      const size = locked ? (locked.opt.size === EMPTY_OPT ? 'FREE' : locked.opt.size) : '';
      setNotice(t('importProductV3.modal.finishOptionFirst', { option: [color, size].filter(Boolean).join(' ') }));
      return true;
    },
    [lockedOptionId, optionIndex, t]
  );

  // ============================================================
  // 입력 확정 — 옵션 단위 / 행 단위
  // ============================================================
  const commitOption = useCallback(
    (optionId: string, qty: number): boolean => {
      const entry = optionIndex.get(optionId);
      if (!entry) return false;
      if (qty > 0 && rejectOtherOption(optionId)) return false;
      const rows = entry.opt.rows;
      const rowIds = rows.map((r) => r.id);
      if (qty <= 0) {
        batch.setOptionAlloc(rowIds, new Map());
        return true;
      }
      const result = distribute(
        rows.map((r) => ({ id: r.id, remaining: remainingOf(r, maps.arrivalMap, maps.cancelMap) })),
        qty
      );
      if (result.overflow > 0) {
        setNotice(t('importProductV3.modal.overLimit', { max: qty - result.overflow }));
        return false;
      }
      batch.setOptionAlloc(rowIds, result.alloc);
      return true;
    },
    [optionIndex, batch, maps.arrivalMap, maps.cancelMap, rejectOtherOption, t]
  );

  const commitRow = useCallback(
    (rowId: string, qty: number): boolean => {
      const row = rowsById.get(rowId);
      if (!row) return false;
      if (qty > 0 && rejectOtherOption(optionIdByRowId.get(rowId))) return false;
      const remaining = remainingOf(row, maps.arrivalMap, maps.cancelMap);
      if (qty > remaining) {
        setNotice(t('importProductV3.modal.overLimit', { max: remaining }));
        return false;
      }
      batch.setRowAlloc(rowId, qty);
      return true;
    },
    [rowsById, maps.arrivalMap, maps.cancelMap, batch, rejectOtherOption, optionIdByRowId, t]
  );

  // ============================================================
  // 요약 (푸터)
  // ============================================================
  const summary = useMemo(() => {
    let qty = 0;
    let options = 0;
    for (const { opt } of optionIndex.values()) {
      const sum = opt.rows.reduce((n, r) => n + (batch.alloc.get(r.id) ?? 0), 0);
      if (sum > 0) options += 1;
      qty += sum;
    }
    const careRows = planCareLabels(batch.alloc, rowsById);
    const care = careRows.reduce((n, r) => n + r.qty, 0);
    // 케어라벨이 어느 색상 것인지 — 푸터에 함께 표시 (세트를 색상별로 붙일 때 헷갈리지 않게)
    const careColors = Array.from(
      new Set(
        careRows
          .map(({ item }) => board?.cards.find((c) => c.key === cardKeyByRowId.get(item.id))?.color)
          .filter((c): c is string => !!c && c !== EMPTY_OPT)
      )
    );
    return { qty, options, care, careColors };
  }, [optionIndex, batch.alloc, rowsById, board, cardKeyByRowId]);

  const hasAlloc = batch.alloc.size > 0;
  const hasPrintable = summary.care > 0;
  const stickerSheets = sticker.preview.totalSheets;
  const busy = print.isBusy;

  // ============================================================
  // 헤더 부가 액션 — 대상: 체크된 행 (반품은 없으면 보드 전체)
  // ============================================================
  const checkedRows = useMemo(
    () => (board?.rows ?? []).filter((r) => selectedIds.has(r.id)),
    [board, selectedIds]
  );

  const requireChecked = (fn: (items: FtOrderItem[]) => void) => () => {
    if (checkedRows.length === 0) {
      alert(t('importProductV3.alerts.selectRows'));
      return;
    }
    fn(checkedRows);
  };

  // 운송장: 이번 배분의 P 행 → 없으면 체크된 행
  const invoiceTargets = useMemo(() => {
    const allocP = Array.from(batch.alloc.keys())
      .map((id) => rowsById.get(id))
      .filter((r): r is FtOrderItem => !!r && r.shipment_type?.trim().toUpperCase() === 'PERSONAL');
    return allocP.length > 0 ? allocP : checkedRows;
  }, [batch.alloc, rowsById, checkedRows]);
  const invoiceEnabled = invoiceTargets.some(isItemInvoicePrintable);

  // ============================================================
  // 닫기 — 작업 중엔 잠금, 저장 안 한 입력은 확인
  // ============================================================
  const handleClose = useCallback(() => {
    if (busy) return;
    if (batch.hasPending && !window.confirm(t('importProductV3.modal.unsavedClose'))) return;
    onClose();
  }, [busy, batch.hasPending, onClose, t]);

  if (!board) return null;

  const headCard = board.cards[0];
  const selectedTitle = selected
    ? `${selected.card.color === EMPTY_OPT ? '' : selected.card.color} · ${
        selected.opt.size === EMPTY_OPT ? 'FREE' : selected.opt.size
      }`
    : '';

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="v3-modal-overlay" onClick={handleClose}>
      <div className="v3-modal" onClick={(e) => e.stopPropagation()}>
        {/* ============================================================ */}
        {/* 헤더                                                          */}
        {/* ============================================================ */}
        <header className="v3-modal-header">
          <div className="v3-modal-heading">
            <h2 title={headCard.title}>{headCard.title}</h2>
            {headCard.siteUrl ? (
              <a href={headCard.siteUrl} target="_blank" rel="noopener noreferrer" className="v3-modal-offer">
                {t('importProductV3.modal.offer')} {headCard.offerId ?? ''}
              </a>
            ) : (
              headCard.offerId && (
                <span className="v3-modal-offer">
                  {t('importProductV3.modal.offer')} {headCard.offerId}
                </span>
              )
            )}
          </div>
          <div className="v3-modal-actions">
            <button
              type="button"
              className="v3-action-btn"
              disabled={busy}
              onClick={() => onOpenCancel(checkedRows.length > 0 ? checkedRows : board.rows)}
            >
              ↩️ {t('importProductV2.buttons.cancel')}
            </button>
            <button type="button" className="v3-action-btn" disabled={busy} onClick={requireChecked(onOpenNote)}>
              📝 {t('importProductV2.buttons.note')}
            </button>
            <button
              type="button"
              className="v3-action-btn"
              disabled={busy}
              onClick={requireChecked(onOpenCustomerConfirm)}
            >
              🙋 {t('importProductV2.buttons.customerConfirm')}
            </button>
            <button
              type="button"
              className="v3-action-btn"
              disabled={busy || !invoiceEnabled}
              onClick={() => onPrintInvoices(invoiceTargets)}
            >
              🎟️ {t('importProductV2.buttons.shipping')}
            </button>
            <button type="button" className="v3-icon-btn v3-modal-close" disabled={busy} onClick={handleClose}>
              ✕
            </button>
          </div>
        </header>

        {/* ============================================================ */}
        {/* 본문 — 좌: 옵션 / 우: 주문행                                  */}
        {/* ============================================================ */}
        <div className="v3-modal-body">
          <div className="v3-modal-left">
            <OptionList
              board={board}
              externalParts={externalParts}
              lockedOptionId={lockedOptionId}
              arrivalMap={maps.arrivalMap}
              alloc={batch.alloc}
              status={batch.status}
              selectedOptionId={selectedOptionId}
              disabled={busy}
              onSelectOption={setSelectedOptionId}
              onCommitOption={commitOption}
            />
          </div>
          <div className="v3-modal-right">
            <OrderRowTable
              title={selectedTitle}
              rows={selected?.opt.rows ?? []}
              maps={maps}
              alloc={batch.alloc}
              status={batch.status}
              selectedIds={selectedIds}
              disabled={busy}
              invoicePdfSet={invoicePdfSet}
              isItemInvoicePrintable={isItemInvoicePrintable}
              onToggleRow={(id, checked) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onToggleAll={(ids, checked) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  for (const id of ids) {
                    if (checked) next.add(id);
                    else next.delete(id);
                  }
                  return next;
                })
              }
              onCommitRow={commitRow}
              onProductNameClick={onOpenLog}
            />
            <div className="v3-modal-hint">{t('importProductV3.modal.reallocHint')}</div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 푸터 — 요약 / 템플릿 / 버튼                                   */}
        {/* ============================================================ */}
        <footer className="v3-modal-footer">
          {showStickerPlan && sticker.preview.sets.length > 0 && (
            <StickerPlanPopover
              sets={sticker.preview.sets}
              disabled={busy}
              onOverride={sticker.setOverride}
              onClose={() => setShowStickerPlan(false)}
            />
          )}

          <div className="v3-footer-summary">
            <span>{t('importProductV3.footer.summary', { options: summary.options, qty: summary.qty })}</span>
            <span className="v3-footer-sep">|</span>
            {sticker.preview.sets.length > 0 ? (
              <button type="button" className="v3-link-btn" onClick={() => setShowStickerPlan((v) => !v)}>
                {t('importProductV3.footer.sticker', { count: stickerSheets })}
                {sticker.preview.skippedSheets > 0 &&
                  ` (${t('importProductV3.footer.stickerSkipped', { count: sticker.preview.skippedSheets })})`}
              </button>
            ) : (
              <span>{t('importProductV3.footer.sticker', { count: stickerSheets })}</span>
            )}
            <span className="v3-footer-sep">|</span>
            <span>
              {t('importProductV3.footer.care', { count: summary.care })}
              {summary.careColors.length > 0 && ` (${summary.careColors.join(', ')})`}
            </span>
            {sticker.preview.sets.some((s) => s.toPrint > 0) && (
              <span className="v3-footer-hint">{t('importProductV3.footer.stickerKeep')}</span>
            )}
            {notice && <span className="v3-footer-notice">{notice}</span>}
          </div>

          {hasPrintable && (
            <div className="v3-footer-templates">
              <LabelTemplatePicker
                plan={templatePlan}
                labelType="barcode"
                title={t('importProduct.processReady.labelSticker')}
                disabled={busy}
              />
              <LabelTemplatePicker
                plan={templatePlan}
                labelType="care"
                title={t('importProduct.processReady.careLabel')}
                disabled={busy}
              />
            </div>
          )}

          <div className="v3-footer-actions">
            <div className="v3-footer-flash">
              {print.flashes.map((f, i) => (
                <span key={i} className="v3-flash">
                  ✓ {f}
                </span>
              ))}
            </div>

            <button
              type="button"
              className="v3-footer-btn v3-btn-save"
              disabled={!hasAlloc || busy || batch.status === 'saved'}
              onClick={() => print.save()}
            >
              {print.isSaving && !print.isRunningAll
                ? t('importProduct.processReady.saving')
                : batch.status === 'saved'
                  ? t('importProduct.processReady.saved')
                  : t('importProduct.processReady.save')}
            </button>

            {/* 세트 스티커가 이미 출력돼 0장이면 회색으로 보이지만 누를 수 있다
                → 누르면 "이미 출력됨 — 그래도 다시 출력?" 확인 (useV3Print.printSticker) */}
            <button
              type="button"
              className={`v3-footer-btn v3-btn-print ${hasPrintable && stickerSheets === 0 ? 'v3-btn-muted' : ''}`}
              disabled={!hasPrintable || busy || templatePlan.loading || barcodeMissing}
              title={stickerSheets === 0 && hasPrintable ? t('importProductV3.footer.stickerNone') : undefined}
              onClick={() => print.printSticker(batch.status === 'editing')}
            >
              {print.isPrintingBarcode && !print.isRunningAll
                ? t('importProduct.processReady.printing')
                : hasPrintable && stickerSheets === 0
                  ? t('importProductV3.footer.stickerNone')
                  : t('importProduct.processReady.labelSticker')}
            </button>

            <button
              type="button"
              className="v3-footer-btn v3-btn-print"
              disabled={!hasPrintable || busy || templatePlan.loading || careMissing}
              onClick={() => print.printCare()}
            >
              {print.isPrintingCare && !print.isRunningAll
                ? t('importProduct.processReady.printing')
                : t('importProduct.processReady.careLabel')}
            </button>

            <button
              type="button"
              className="v3-footer-btn v3-btn-all"
              disabled={
                !hasPrintable ||
                busy ||
                templatePlan.loading ||
                careMissing ||
                (barcodeMissing && stickerSheets > 0)
              }
              onClick={() => print.runAll()}
            >
              {print.isRunningAll ? (
                <span className="v3-btn-loading">
                  <span className="v2-spinner" />
                  {t('importProduct.processReady.all')}
                </span>
              ) : (
                t('importProduct.processReady.all')
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default CardModal;
