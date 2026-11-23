'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkCard } from '../../../storage/types';
import { cardStatus, type DeckSummary } from '../utils/cardState';

// ============================================================
// EndCard — 카드 묶음의 마지막 장 (정리 + 작업완료)
//
//   · 찾음 / 부족 / 전체 카드 수
//       찾음 = 표시한 위치 카드 · 부족 = 부족으로 확인한 "재고 없음" 카드
//   · 담는 박스 — 크기를 바꿀 때 누르는 버튼 (다 찾고 나서 상자를 바꿔 담는 일이 많다)
//   · 부족 상품 목록 (누르면 그 카드로) — 부족 수량 = 그 카드들의 몫 합
//   · 표시하지 않은 카드가 남았으면 "아직 n장 남았습니다" + [남은 카드로]
//   · 전부 표시했으면 [작업완료] — 하나도 꺼내지 못한 박스도 작업완료할 수 있다 (출고 없이 마감).
//     부족이 있거나 하나도 꺼내지 못했을 때 한 번 더 묻는 일은 부르는 쪽(DeckScreen)이 한다
//   · [목록으로]
// ============================================================

interface EndCardProps {
  cards: WowWorkCard[];
  summary: DeckSummary;
  /** 발주번호-박스번호 · 담는 박스의 크기 (null = 크기 없음) */
  boxLabel: string;
  boxSize: string | null;
  /** 저장 중 — 버튼을 잠근다 */
  busy: boolean;
  onChangeSize: () => void;
  onJump: (index: number) => void;
  onGoLeft: () => void;
  onComplete: () => void;
  onBackToList: () => void;
}

const EndCard: React.FC<EndCardProps> = ({
  cards, summary, boxLabel, boxSize, busy, onChangeSize, onJump, onGoLeft, onComplete, onBackToList,
}) => {
  const { t } = useTranslation();
  const { total, taken, short, left, takenQty, shortQty } = summary;

  const allMarked = total > 0 && left === 0;

  // ── 제목 · 설명 ──
  const title =
    total === 0 ? t('mobile.wow.end.emptyTitle')
    : left > 0 ? t('mobile.wow.end.leftTitle', { count: left })
    : t('mobile.wow.end.doneTitle');
  const desc =
    total === 0 ? t('mobile.wow.end.emptyDesc')
    : left > 0 ? t('mobile.wow.end.leftDesc')
    : short > 0 ? t('mobile.wow.end.shortDesc', { qty: shortQty })
    : t('mobile.wow.end.allFoundDesc', { qty: takenQty });

  return (
    <div className="mwow-cardw">
      <div className="mwow-card is-end">
        <div className={`mwow-ring${allMarked ? ' is-ok' : ''}`} aria-hidden="true">{allMarked ? '✓' : '…'}</div>
        <div className="mwow-end-text">
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>

        {/* 카드 수 */}
        <div className="mwow-tiles">
          <div className="mwow-tile is-ok"><span>{t('mobile.wow.end.tileFound')}</span><b>{taken}</b></div>
          <div className="mwow-tile is-short"><span>{t('mobile.wow.end.tileShort')}</span><b>{short}</b></div>
          <div className="mwow-tile"><span>{t('mobile.wow.end.tileTotal')}</span><b>{total}</b></div>
        </div>

        {/* 담는 박스 — 크기 변경 */}
        <div className="mwow-endbox">
          <div className="mwow-endbox-label">{t('mobile.wow.end.boxLabel')}</div>
          <button type="button" className="mwow-endbox-btn" disabled={busy} onClick={onChangeSize}>
            <span><span aria-hidden="true">📦</span> {boxLabel} · {boxSize ?? t('mobile.wow.size.none')}</span>
            <small>{t('mobile.wow.end.changeSize')} ▾</small>
          </button>
        </div>

        {/* 부족 상품 */}
        {short > 0 && (
          <div className="mwow-shortlist">
            <div className="mwow-shortlist-label">{t('mobile.wow.end.shortList')}</div>
            {cards.map((c, i) => (cardStatus(c) !== 'short' ? null : (
              <button key={c.key} type="button" className="mwow-shortrow" onClick={() => onJump(i)}>
                <span className="mwow-shortrow-body">
                  <span className="mwow-shortrow-name">{c.item_name ?? '-'}</span>
                  <span className="mwow-shortrow-meta">{c.barcode ?? ''}</span>
                </span>
                <span className="mwow-shortrow-qty">{t('mobile.wow.card.short', { qty: c.plan_qty })}</span>
              </button>
            )))}
          </div>
        )}

        {/* 아래 버튼 */}
        <div className="mwow-end-foot">
          {left > 0 && (
            <button type="button" className="mob-btn accent" onClick={onGoLeft}>{t('mobile.wow.end.toLeft')}</button>
          )}
          {allMarked && (
            <button type="button" className="mob-btn accent" disabled={busy} onClick={onComplete}>
              {t('mobile.wow.end.complete')}
            </button>
          )}
          <button type="button" className="mob-btn secondary" onClick={onBackToList}>{t('mobile.wow.end.toList')}</button>
        </div>
      </div>
    </div>
  );
};

export default EndCard;
