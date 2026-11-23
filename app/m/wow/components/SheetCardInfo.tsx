'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkCard } from '../../../storage/types';
import { hasLocation } from '../utils/cardState';

// ============================================================
// SheetCardInfo — 아래에서 올라오는 창(부족 · 메모) 위쪽에 "어느 카드인지" 두 줄로 보여 준다
//   위치 · 바코드
//   상품명 (길면 한 줄로 자른다)
// ============================================================

interface SheetCardInfoProps {
  card: WowWorkCard;
}

const SheetCardInfo: React.FC<SheetCardInfoProps> = ({ card }) => {
  const { t } = useTranslation();
  const where = hasLocation(card) ? (card.location_code ?? '?') : t('mobile.wow.card.noStock');

  return (
    <p className="mwow-sheet-info">
      <span><b>{where}</b>{card.barcode ? ` · ${card.barcode}` : ''}</span>
      <span className="mwow-sheet-info-name">{card.item_name ?? ''}</span>
    </p>
  );
};

export default SheetCardInfo;
