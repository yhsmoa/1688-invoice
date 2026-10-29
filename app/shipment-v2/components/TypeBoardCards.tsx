'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardSummary } from '../utils/boardSummary';
import { SHIPMENT_SIZE_CODES, type ShipmentSizeCode } from '../utils/shipmentCodes';
import { BOARD_ALL, isSameBoard, type BoardFilter } from '../utils/rowFilter';

// ============================================================
// 상단 카드 보드 — [전체] [A] [B] [C] [P] [X] [요청]
//   카드 = 박스 수(큰 숫자) + 상품 행 수. 클릭 → 해당 행만, 같은 카드 재클릭 → 전체
//   타입 색은 사이트 공용 배지 팔레트(A/B/C 파랑 · P 주황 · X 검정), 요청은 보라
// ============================================================

/** 타입 라벨 — 박스 생성 모달과 같은 키 (소형/중형/대형/개인/직발) */
const TYPE_LABEL_KEY: Record<ShipmentSizeCode, string> = {
  A: 'exportProduct.box.typeA',
  B: 'exportProduct.box.typeB',
  C: 'exportProduct.box.typeC',
  P: 'exportProduct.box.typeP',
  X: 'exportProduct.box.typeX',
};

interface TypeBoardCardsProps {
  summary: BoardSummary;
  board: BoardFilter;
  onBoardChange: (board: BoardFilter) => void;
}

const TypeBoardCards: React.FC<TypeBoardCardsProps> = ({ summary, board, onBoardChange }) => {
  const { t } = useTranslation();

  const select = (next: BoardFilter) => onBoardChange(isSameBoard(board, next) ? BOARD_ALL : next);
  const cardClass = (target: BoardFilter, tone: string, extra = '') =>
    ['sv2-card', `sv2-card--${tone}`, isSameBoard(board, target) ? 'is-active' : '', extra]
      .filter(Boolean)
      .join(' ');

  return (
    <div className="sv2-board" role="tablist">
      {/* ── 전체 ── */}
      <button
        type="button"
        role="tab"
        aria-selected={board.kind === 'all'}
        className={cardClass(BOARD_ALL, 'all')}
        onClick={() => onBoardChange(BOARD_ALL)}
      >
        <span className="sv2-card-head">
          <span className="sv2-card-label">{t('shipmentV2.board.all')}</span>
        </span>
        <span className="sv2-card-value">
          {summary.all.boxes}
          <span className="sv2-card-unit">{t('shipmentV2.board.boxes')}</span>
        </span>
        <span className="sv2-card-sub">{t('shipmentV2.board.rows', { count: summary.all.rows })}</span>
      </button>

      {/* ── A / B / C / P / X ── */}
      {SHIPMENT_SIZE_CODES.map((code) => {
        const count = summary.byType[code];
        const target: BoardFilter = { kind: 'type', type: code };
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={isSameBoard(board, target)}
            className={cardClass(target, code.toLowerCase(), count.boxes === 0 ? 'is-empty' : '')}
            onClick={() => select(target)}
          >
            <span className="sv2-card-head">
              <span className={`sv2-type-chip sv2-type-chip--${code.toLowerCase()}`}>{code}</span>
              <span className="sv2-card-label">{t(TYPE_LABEL_KEY[code])}</span>
            </span>
            <span className="sv2-card-value">
              {count.boxes}
              <span className="sv2-card-unit">{t('shipmentV2.board.boxes')}</span>
            </span>
            <span className="sv2-card-sub">{t('shipmentV2.board.rows', { count: count.rows })}</span>
          </button>
        );
      })}

      {/* ── 요청 (고객 미처리 이동요청) ── */}
      {(() => {
        const target: BoardFilter = { kind: 'requests' };
        return (
          <button
            type="button"
            role="tab"
            aria-selected={isSameBoard(board, target)}
            className={cardClass(target, 'request', summary.requests > 0 ? 'has-pending' : 'is-empty')}
            onClick={() => select(target)}
            title={t('shipmentV2.board.requestsHint')}
          >
            <span className="sv2-card-head">
              {summary.requests > 0 && <span className="sv2-pulse-dot" aria-hidden="true" />}
              <span className="sv2-card-label">{t('shipmentV2.board.requests')}</span>
            </span>
            <span className="sv2-card-value">
              {summary.requests}
              <span className="sv2-card-unit">{t('shipmentV2.board.requestUnit')}</span>
            </span>
            <span className="sv2-card-sub">{t('shipmentV2.board.requestsHint')}</span>
          </button>
        );
      })()}
    </div>
  );
};

export default TypeBoardCards;
