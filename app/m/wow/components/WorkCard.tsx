'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkCard } from '../../../storage/types';
import { proxyImageUrl, THUMB_WIDTH_LARGE } from '../../../../lib/imageProxy';
import { formatDateTime, joinOptions } from '../../../storage/utils/storageFormat';
import { cardStatus, hasLocation } from '../utils/cardState';

// ============================================================
// WorkCard — 카드 한 장
//
//   위치 카드       = 상품 하나를 위치 한 곳에서 꺼내는 일
//   위치 없는 카드  = 어디에도 재고가 없는 몫 (부족) — 위치 대신 "재고 없음" 을 보여 준다
//
//   위에서부터
//     · 표시 띠 (표시한 카드만)
//         위치 카드      : 꺼냄 n개 (0 이면 "여기엔 없음") · 누가 · 언제 · [수정] [취소]
//         위치 없는 카드 : 부족 n개 · 누가 · 언제 · [취소]
//     · 꺼낼 위치 (크게) + 그 위치 재고 · 같은 상품의 다른 위치
//     · 상품 사진
//     · 상품명 · 옵션 · 바코드 · 상품번호
//     · 메모 (있을 때만 — 누르면 메모 창)
//     · 수량 (카드에서 가장 큰 숫자) : 꺼낼 수량 / 꺼낸 수량 / 모자란 수량
// ============================================================

interface WorkCardProps {
  card: WowWorkCard;
  /** 저장 중 — 띠의 버튼을 잠근다 */
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onMemo: () => void;
}

const WorkCard: React.FC<WorkCardProps> = ({ card, busy, onEdit, onCancel, onMemo }) => {
  const { t } = useTranslation();
  const [imgFailed, setImgFailed] = useState(false);

  const status = cardStatus(card);
  const located = hasLocation(card);
  /** 표시한 위치 카드인데 꺼낸 수량이 0 = 여기엔 없음 */
  const noneHere = status === 'taken' && card.found_qty === 0;
  /** 띠 · 카드 테두리 색을 정하는 이름 */
  const tone = status === null ? '' : noneHere ? 'none' : status;

  const options = joinOptions(card.option_name, card.china_option1, card.china_option2);
  const markedBy = [card.found_by, formatDateTime(card.found_at)].filter(Boolean).join(' · ');
  const memoBy = [card.memo_by, formatDateTime(card.memo_at)].filter(Boolean).join(' · ');

  // ── 띠 문구 ──
  const bandText =
    status === 'short' ? t('mobile.wow.card.short', { qty: card.plan_qty })
    : noneHere ? t('mobile.wow.card.noneHere')
    : t('mobile.wow.card.taken', { qty: card.found_qty });

  // ── 큰 숫자: 위치 없는 카드 = 모자란 몫 · 표시한 위치 카드 = 꺼낸 수량 · 그 밖 = 꺼낼 몫 ──
  const bigQty = status === 'taken' ? (card.found_qty ?? 0) : card.plan_qty;
  const qtyLabel =
    !located ? t('mobile.wow.card.lackQty')
    : status === 'taken' ? t('mobile.wow.card.takenQty')
    : t('mobile.wow.card.takeQty');

  return (
    <div className="mwow-cardw">
      <div className={`mwow-card${tone ? ` is-${tone}` : ''}`}>
        {/* 표시 띠 */}
        {status && (
          <div className={`mwow-band is-${tone}`}>
            <div className="mwow-band-main">
              <b>{bandText}</b>
              <small>{markedBy}</small>
            </div>
            <div className="mwow-band-btns">
              {located && (
                <button type="button" disabled={busy} onClick={onEdit}>{t('mobile.wow.card.edit')}</button>
              )}
              <button type="button" disabled={busy} onClick={onCancel}>{t('mobile.wow.card.cancel')}</button>
            </div>
          </div>
        )}

        {/* 꺼낼 위치 */}
        <div className="mwow-where">
          {located ? (
            <div className="mwow-loc">
              <span className="mwow-loc-code">{card.location_code ?? '?'}</span>
              <span className="mwow-loc-stock">{t('mobile.wow.card.stock', { qty: card.stock_qty })}</span>
            </div>
          ) : (
            <div className="mwow-loc is-none">
              <span className="mwow-loc-code">{t('mobile.wow.card.noStock')}</span>
              <span className="mwow-loc-stock">
                {status === 'short'
                  ? t('mobile.wow.card.short', { qty: card.plan_qty })
                  : t('mobile.wow.card.shortHint', { qty: card.plan_qty })}
              </span>
            </div>
          )}
          {card.spares.length > 0 && (
            <div className="mwow-spares">
              <span className="mwow-spares-label">{t('mobile.wow.card.spares')}</span>
              {card.spares.map((s, i) => (
                <span key={`${s.location_code}-${i}`} className="mwow-spare">{s.location_code}<small>{s.qty}</small></span>
              ))}
            </div>
          )}
        </div>

        {/* 상품 사진 */}
        <div className="mwow-thumb">
          {card.img_url && !imgFailed ? (
            <img
              src={proxyImageUrl(card.img_url, THUMB_WIDTH_LARGE)}
              alt=""
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span className="mwow-noimg">{t('mobile.wow.card.noImage')}</span>
          )}
        </div>

        {/* 상품 */}
        <div className="mwow-product">
          <div className="mwow-name">{card.item_name ?? '-'}</div>
          {options && <div className="mwow-opt">{options}</div>}
          <div className="mwow-codes">
            <span className="mwow-barcode">{card.barcode ?? '-'}</span>
            {card.product_no && <span className="mwow-pno">{card.product_no}</span>}
          </div>
        </div>

        {/* 메모 */}
        {card.memo && (
          <button type="button" className="mwow-memo-line" onClick={onMemo}>
            <span aria-hidden="true">📝</span>
            <span className="mwow-memo-body">
              {card.memo}
              {memoBy && <small>{memoBy}</small>}
            </span>
          </button>
        )}

        {/* 수량 */}
        <div className="mwow-qty">
          <span className="mwow-qty-k">{qtyLabel}</span>
          <span className="mwow-qty-v">{bigQty}</span>
          <span className="mwow-qty-u">{t('mobile.wow.card.unit')}</span>
          {card.line_qty !== bigQty && (
            <span className="mwow-qty-line">{t('mobile.wow.card.lineQty', { qty: card.line_qty })}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkCard;
