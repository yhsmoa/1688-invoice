'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkBox } from '../../../storage/types';
import { formatMonthDay, isBoxMarked } from '../utils/cardState';

// ============================================================
// BoxList — 목록 화면
//
//   [입력 칸 + 카메라] → [진행] → 안내 한 줄 → 박스 목록
//   · 발주번호만 치면 아래 목록이 걸러진다
//   · 박스 라벨(발주번호-박스번호)을 치거나 카메라로 찍으면 바로 그 박스로 간다
//   · 줄을 누르면 그 박스의 카드로 간다
//   무엇을 열지는 부르는 쪽(WowWork)이 정한다 — 여기는 그리기만 한다
// ============================================================

interface BoxListProps {
  operatorName: string;
  /** null = 아직 받지 못함 */
  boxes: WowWorkBox[] | null;
  /** 거른 뒤 화면에 보일 박스 */
  visible: WowWorkBox[];
  /** 거르기 값 ('' = 거르지 않음) */
  filter: string;
  refreshing: boolean;
  /** 처음 목록을 받지 못했을 때의 사유 */
  loadError: string | null;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onOpenCamera: () => void;
  onPickBox: (box: WowWorkBox) => void;
  onNextBox: () => void;
  onRefresh: () => void;
  onClearFilter: () => void;
  onChangeWorker: () => void;
}

const BoxList: React.FC<BoxListProps> = ({
  operatorName, boxes, visible, filter, refreshing, loadError, input,
  onInputChange, onSubmit, onOpenCamera, onPickBox, onNextBox, onRefresh, onClearFilter, onChangeWorker,
}) => {
  const { t } = useTranslation();

  const left = visible.filter((b) => !isBoxMarked(b)).length;
  const orderCount = new Set(visible.map((b) => b.order_number)).size;

  // ── 목록이 비었을 때의 안내 ──
  const emptyText =
    boxes === null ? (loadError ?? t('mobile.wow.list.loading'))
    : boxes.length === 0 ? t('mobile.wow.list.empty')
    : visible.length === 0 ? t('mobile.wow.list.orderMissing', { order: filter })
    : null;

  // ── 줄 오른쪽 진행 표시 ──
  const pill = (b: WowWorkBox) => {
    const marked = b.found_cards + b.short_cards;
    if (!isBoxMarked(b)) {
      return <span className={`mwow-pill${marked > 0 ? ' is-part' : ''}`}>{marked} / {b.cards}</span>;
    }
    return b.short_cards > 0
      ? <span className="mwow-pill is-short">{t('mobile.wow.list.short', { count: b.short_cards })}</span>
      : <span className="mwow-pill is-ok">✓ {t('mobile.wow.list.allFound')}</span>;
  };

  return (
    <main className="mob-body">
      {/* 담당자 */}
      <div className="mob-worker-row">
        <span>{t('mobile.wow.worker.current')} <b>{operatorName}</b></span>
        <button type="button" className="mob-text-btn" onClick={onChangeWorker}>{t('mobile.wow.worker.change')}</button>
      </div>

      {/* 입력 + 카메라 */}
      <div className="mob-scanrow">
        <input
          className="mob-input mob-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          value={input}
          placeholder={t('mobile.wow.list.inputPlaceholder')}
          aria-label={t('mobile.wow.list.inputLabel')}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        />
        <button type="button" className="mob-cam-btn" onClick={onOpenCamera} aria-label={t('mobile.wow.list.camera')}>
          <span aria-hidden="true">📷</span>
        </button>
      </div>
      <button type="button" className="mob-btn accent" onClick={onSubmit}>{t('mobile.wow.list.go')} →</button>
      <div className="mob-hint">{t('mobile.wow.list.hint')}</div>

      {/* 목록 머리 — 요약 · 새로고침 · 다음 미처리 박스 */}
      <div className="mob-list-head">
        <span className="mob-list-sum">
          {filter ? (
            <span className="mob-filter-chip">
              {t('mobile.wow.list.filtered', { filter, count: visible.length })}
              <button type="button" onClick={onClearFilter}>{t('mobile.wow.list.showAll')}</button>
            </span>
          ) : boxes ? (
            t('mobile.wow.list.summary', { boxes: visible.length, orders: orderCount, left })
          ) : null}
          {refreshing && <span className="mob-busy">{t('mobile.wow.list.refreshing')}</span>}
        </span>
        <span className="mob-list-tools">
          <button type="button" className="mob-text-btn" onClick={onNextBox}>{t('mobile.wow.list.next')} ›</button>
          <button
            type="button"
            className="mob-icon-btn"
            disabled={refreshing}
            onClick={onRefresh}
            aria-label={t('mobile.wow.list.refresh')}
            title={t('mobile.wow.list.refresh')}
          >
            ↻
          </button>
        </span>
      </div>

      {/* 박스 목록 */}
      <div className="mob-list">
        {emptyText && <div className="mob-empty">{emptyText}</div>}
        {visible.map((b) => (
          <button
            key={b.box_id}
            type="button"
            className={`mwow-row${isBoxMarked(b) ? (b.short_cards > 0 ? ' is-short' : ' is-ok') : ''}`}
            onClick={() => onPickBox(b)}
          >
            <span className="mwow-row-body">
              <span className="mwow-row-no">
                {b.order_number}<span className="mwow-row-dash">-</span>{b.box_no}
                {b.box_size && <span className="mwow-row-size">📦 {b.box_size}</span>}
              </span>
              <span className="mwow-row-meta">
                {b.center || '-'} · {formatMonthDay(b.arrival_date) || '-'}
                <span className="mwow-row-qty">{t('mobile.wow.list.qty', { count: b.qty })}</span>
              </span>
            </span>
            {pill(b)}
          </button>
        ))}
      </div>
    </main>
  );
};

export default BoxList;
