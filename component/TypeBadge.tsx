'use client';

import React from 'react';
import { resolveTypeBadge, type TypeBadgeInfo } from '../lib/sizeCode';

// ============================================================
// TypeBadge — 화면의 "타입" 배지 한 축 (A/B/C/P/X/S)
//
//   · info 를 직접 주거나 item 을 주면 resolveTypeBadge 로 판정한다
//   · S(보관) 는 노란 반짝이는 배지 (globals.css .size-badge--stock) — S 단독, 다른 배지와 같이 쓰지 않는다
//   purchase-agent components/TypeBadge.tsx 와 같은 표기 — 바꿀 때 양쪽 같이
// ============================================================

type ItemLike = {
  arrival_route?: string | null;
  shipment_type?: string | null;
  coupang_shipment_size?: string | null;
};

interface TypeBadgeProps {
  item?: ItemLike | null;
  info?: TypeBadgeInfo | null;
}

const TypeBadge: React.FC<TypeBadgeProps> = ({ item, info }) => {
  const badge = info ?? resolveTypeBadge(item);
  if (!badge) return null;
  const title = badge.code === 'S' ? '보관 — 박스 타입은 재고에서 꺼낼 때 정합니다' : undefined;
  return <span className={`size-badge ${badge.colorClass}`} title={title}>{badge.code}</span>;
};

export default TypeBadge;
