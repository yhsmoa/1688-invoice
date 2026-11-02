'use client';

import React from 'react';
import { isStockRoute } from '../lib/sizeCode';

// ============================================================
// StockChip — 보관(STOCK) 상품 표시 [S]
//
//   타입 배지([A] 등) 바로 옆에 둔다. 보관이 아니면 아무것도 그리지 않는다.
//   스타일: app/globals.css .route-chip--stock
// ============================================================

interface StockChipProps {
  item: { arrival_route?: string | null } | null | undefined;
}

const StockChip: React.FC<StockChipProps> = ({ item }) =>
  isStockRoute(item) ? (
    <span className="route-chip--stock" title="보관 — 입고 후 재고 위치에 배치">S</span>
  ) : null;

export default StockChip;
