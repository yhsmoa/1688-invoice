'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { mergeStatus, optionDbStatus, type Card } from '../utils/buildBoards';
import { EMPTY_OPT } from '../utils/groupKeys';

// ============================================================
// 상품 카드 1장 — (오퍼 + 색상) 묶음
//   이미지 / 색상 원문 / 상품명 / 옵션 수 · 잔여 / 상태 띠
//   상태 띠: 옵션 전부 완료 → 초록, 하나라도 덜 들어옴 → 주황 (DB 기준)
// ============================================================

interface ProductCardProps {
  card: Card;
  /** 세트 보드 안 카드면 "SET 1/2" 표시 */
  setLabel?: string | null;
}

const ProductCard: React.FC<ProductCardProps> = ({ card, setLabel }) => {
  const { t } = useTranslation();
  const status = mergeStatus(card.options.map(optionDbStatus));
  const isDone = card.rows.length > 0 && card.remainingTotal === 0;

  return (
    <div className={`v3-card v3-status-${status} ${isDone ? 'v3-card-done' : ''}`}>
      {/* ── 이미지 ── */}
      <div className="v3-card-image">
        {card.imgUrl ? (
          <img
            src={`/api/image-proxy?url=${encodeURIComponent(card.imgUrl)}`}
            alt={card.color}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder.svg';
            }}
          />
        ) : (
          <div className="v3-card-no-image">-</div>
        )}
        {setLabel && <span className="v3-card-set-label">{setLabel}</span>}
        {isDone && <span className="v3-card-done-label">{t('importProductV3.card.done')}</span>}
      </div>

      {/* ── 정보 ── */}
      <div className="v3-card-body">
        <div className="v3-card-color" title={card.color}>
          {card.color === EMPTY_OPT ? '—' : card.color}
        </div>
        <div className="v3-card-title" title={card.title}>
          {card.title}
        </div>
        <div className="v3-card-meta">
          <span>{t('importProductV3.card.options', { count: card.options.length })}</span>
          <span className="v3-card-remaining">
            {t('importProductV3.card.remaining', { remaining: card.remainingTotal, total: card.orderTotal })}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
