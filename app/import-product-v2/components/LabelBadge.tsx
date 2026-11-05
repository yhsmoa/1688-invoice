'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';

// ============================================================
// LabelBadge — 상품명 옆 "라벨 작업" 배지 (원산지 도장 / 혼용률 라벨 출력 / 작업 중지)
//
//   판정은 테이블 행(ItemTableRow)과 V3 보드 헤더가 같은 함수를 쓴다.
//     PERSONAL(P)              → 원산지 도장 (P 는 운송장 배지를 행에서 따로 붙인다)
//     composition 있음         → 혼용률 라벨 출력
//     order_qty < 10           → 원산지 도장
//     그 외                    → 작업 중지
// ============================================================
export type LabelBadgeKind = 'origin' | 'fabric' | 'stop';

export function resolveLabelBadge(
  item: Pick<FtOrderItem, 'shipment_type' | 'composition' | 'order_qty'>
): LabelBadgeKind {
  if (item.shipment_type?.trim().toUpperCase() === 'PERSONAL') return 'origin';
  if (item.composition && String(item.composition).trim()) return 'fabric';
  if ((item.order_qty ?? 0) < 10) return 'origin';
  return 'stop';
}

const I18N_KEY: Record<LabelBadgeKind, string> = {
  origin: 'importProduct.badge.originStamp',
  fabric: 'importProduct.badge.fabricLabel',
  stop: 'importProduct.badge.stopWork',
};

const LabelBadge: React.FC<{ kind: LabelBadgeKind }> = ({ kind }) => {
  const { t } = useTranslation();
  return <span className={`label-badge ${kind}`}>{t(I18N_KEY[kind])}</span>;
};

export default LabelBadge;
