'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import ProductCard from './ProductCard';
import type { Board } from '../utils/buildBoards';
import './BoardGrid.css';

// ============================================================
// 보드 그리드 — 검색 결과를 보드 단위로 나열
//   단품 보드 : 카드 1장
//   세트 보드 : 구성품 카드 2~3장을 하나의 테두리로 묶고 "SET" 리본 표시
//   보드 어디를 눌러도 같은 모달이 열린다 (세트면 구성품이 함께 표시됨)
// ============================================================

interface BoardGridProps {
  boards: Board[];
  loading: boolean;
  /** 보드가 없을 때 안내 문구 */
  emptyMessage: string;
  onOpen: (boardKey: string) => void;
}

const BoardGrid: React.FC<BoardGridProps> = ({ boards, loading, emptyMessage, onOpen }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="v3-grid-empty">
        <span className="v2-spinner" /> {t('importProductV2.table.loading')}
      </div>
    );
  }

  if (boards.length === 0) {
    return <div className="v3-grid-empty">{emptyMessage}</div>;
  }

  return (
    <div className="v3-board-grid">
      {boards.map((board) => (
        <div
          key={board.key}
          role="button"
          tabIndex={0}
          className={`v3-board ${board.isSet ? 'v3-board-set' : ''}`}
          onClick={() => onOpen(board.key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(board.key);
            }
          }}
        >
          {board.isSet && <span className="v3-board-ribbon">{t('importProductV3.card.set')}</span>}
          {board.cards.map((card, idx) => (
            <ProductCard
              key={card.key}
              card={card}
              setLabel={
                card.hasSet
                  ? t('importProductV3.modal.setPart', {
                      seq: card.setSeq ?? idx + 1,
                      total: card.setTotal ?? board.cards.length,
                    })
                  : null
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default BoardGrid;
