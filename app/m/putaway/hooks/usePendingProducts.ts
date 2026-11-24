'use client';

import { useCallback, useRef, useState } from 'react';
import type { PendingProduct } from '../types';
import { groupPending } from '../utils/pendingProducts';
import { fetchPendingRows } from '../utils/putawayApi';

// ============================================================
// usePendingProducts — 배치를 기다리는 상품 목록
//
//   · products = null 이면 아직 한 번도 받지 못한 것 (화면은 "불러오는 중")
//   · 새로 받는 동안에도 가지고 있던 목록은 그대로 보여 준다 — 받은 뒤에 바꿔 끼운다
//   · 요청이 겹치면 마지막 요청의 결과만 쓴다
//   · 실패는 그대로 던진다 (문구 · 안내는 부르는 쪽이 정한다)
//   (/m/wow 의 useWowBoxes 와 같은 방식)
// ============================================================
export function usePendingProducts() {
  const [products, setProducts] = useState<PendingProduct[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seqRef = useRef(0);

  const reload = useCallback(async (): Promise<PendingProduct[]> => {
    seqRef.current += 1;
    const my = seqRef.current;
    setRefreshing(true);
    try {
      const data = groupPending(await fetchPendingRows());
      if (my === seqRef.current) setProducts(data);
      return data;
    } finally {
      if (my === seqRef.current) setRefreshing(false);
    }
  }, []);

  // ── 방금 배치한 상품의 남은 미배치를 바로 맞춘다 (0 이면 목록에서 뺀다) ──
  //   서버가 돌려준 값이라 새로 받기 전에도 맞다. 새로 받지 못해도 화면이 틀리지 않게 한다.
  //   배치 전에 떠난 조회가 뒤늦게 도착해 이 값을 옛 수량으로 덮지 않도록, 받고 있던 조회는 버린다
  const patchUnplaced = useCallback((productId: string, unplaced: number) => {
    seqRef.current += 1;
    setRefreshing(false);
    setProducts((prev) => {
      if (!prev) return prev;
      return unplaced > 0
        ? prev.map((p) => (p.product_id === productId ? { ...p, unplaced } : p))
        : prev.filter((p) => p.product_id !== productId);
    });
  }, []);

  return { products, refreshing, reload, patchUnplaced };
}
