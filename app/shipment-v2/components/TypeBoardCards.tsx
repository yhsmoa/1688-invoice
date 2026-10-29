'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BoardSummary } from '../utils/boardSummary';
import { SHIPMENT_SIZE_CODES, type ShipmentSizeCode } from '../utils/shipmentCodes';
import { BOARD_ALL, isSameBoard, type BoardFilter } from '../utils/rowFilter';

// ============================================================
// 타입 바 — [전체] [A] [B] [C] [P] [X] [이동요청]
//   한 판에 이어 붙인 7칸. 칸 = 박스 수(큰 숫자) + 상품 행 수.
//   선택된 칸은 타입 색 밑줄 + 옅은 바탕. 클릭 → 해당 행만, 같은 칸 재클릭 → 전체
//   (디자인: 클로드 디자인 "쉽먼트 V2 화면 디자인" 캔버스)
// ============================================================

/** 타입 라벨 — 박스 생성 모달과 같은 키 (Small/Medium/Large/Personal/Direct) */
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
  const segClass = (target: BoardFilter, tone: string, empty: boolean) =>
    ['sv2-seg', `sv2-tone--${tone}`, isSameBoard(board, target) ? 'is-active' : '', empty ? 'is-empty' : '']
      .filter(Boolean)
      .join(' ');

  return (
    <div className="sv2-segbar" role="tablist" aria-label={t('shipmentV2.board.all')}>
      {/* ── 전체 ── */}
      <button
        type="button"
        role="tab"
        aria-selected={board.kind === 'all'}
        className={segClass(BOARD_ALL, 'all', summary.all.boxes === 0)}
        onClick={() => onBoardChange(BOARD_ALL)}
      >
        <span className="sv2-seg-head">
          <span className="sv2-seg-label">{t('shipmentV2.board.all')}</span>
        </span>
        <span className="sv2-seg-value">
          {summary.all.boxes}
          <span className="sv2-seg-unit">{t('shipmentV2.board.boxes')}</span>
        </span>
        <span className="sv2-seg-sub">{t('shipmentV2.board.rows', { count: summary.all.rows })}</span>
      </button>

      {/* ── A / B / C / P / X ── */}
      {SHIPMENT_SIZE_CODES.map((code) => {
        const count = summary.byType[code];
        const target: BoardFilter = { kind: 'type', type: code };
        const tone = code.toLowerCase();
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={isSameBoard(board, target)}
            className={segClass(target, tone, count.boxes === 0)}
            onClick={() => select(target)}
          >
            <span className="sv2-seg-head">
              <span className={`sv2-chip-type sv2-tone--${tone}`}>{code}</span>
              <span className="sv2-seg-label">{t(TYPE_LABEL_KEY[code])}</span>
            </span>
            <span className="sv2-seg-value">
              {count.boxes}
              <span className="sv2-seg-unit">{t('shipmentV2.board.boxes')}</span>
            </span>
            <span className="sv2-seg-sub">{t('shipmentV2.board.rows', { count: count.rows })}</span>
          </button>
        );
      })}

      {/* ── 이동요청 (고객 미처리) ── */}
      {(() => {
        const target: BoardFilter = { kind: 'requests' };
        const pending = summary.requests > 0;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={isSameBoard(board, target)}
            className={`${segClass(target, 'req', !pending)} ${pending ? 'has-pending' : ''}`}
            onClick={() => select(target)}
          >
            <span className="sv2-seg-head">
              {pending && <span className="sv2-pulse-dot" aria-hidden="true" />}
              <span className="sv2-seg-label">{t('shipmentV2.board.requests')}</span>
            </span>
            <span className="sv2-seg-value">
              {summary.requests}
              <span className="sv2-seg-unit">{t('shipmentV2.board.requestUnit')}</span>
            </span>
            <span className="sv2-seg-sub">{t('shipmentV2.board.requestsHint')}</span>
          </button>
        );
      })()}
    </div>
  );
};

export default TypeBoardCards;
