'use client';

import { useCallback, useMemo, useState } from 'react';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { setInstanceKeyOf } from '../utils/groupKeys';

// ============================================================
// 세트 형제 행 — 검색 결과 밖에 있는 세트 구성품
//
// 세트 1벌(product_id)의 구성품이 다른 1688 주문으로 따로 오면 배송번호 검색에는
// 한쪽만 보인다. 모달을 열 때 product_id 로 나머지 구성품을 가져와
//   · 세트 라벨 스티커 계산 (다른 구성품의 입고·취소·출력 기록)
//   · 모달의 "이 배송에 없음" 회색 블록
// 에 쓴다. 가져온 행은 allItems 에 합쳐져 입고/취소 합계 조회 범위에도 들어간다.
// ============================================================
export function useSetSiblings(activeItems: FtOrderItem[]) {
  const [siblings, setSiblings] = useState<FtOrderItem[]>([]);
  const [loading, setLoading] = useState(false);

  // ── 보드 행들의 세트 product_id 로 형제 조회 → 누적 (id 중복 제거) ──
  const loadForRows = useCallback(async (rows: FtOrderItem[]) => {
    const productIds = Array.from(
      new Set(rows.map(setInstanceKeyOf).filter((v): v is string => v !== null))
    );
    if (productIds.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch('/api/ft/order-items/by-product-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: productIds }),
      });
      const json = await res.json();
      if (!json.success) {
        console.error('세트 구성품 조회 실패:', json.error);
        return;
      }
      const fetched = json.data as FtOrderItem[];
      setSiblings((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const r of fetched) byId.set(r.id, r);
        return Array.from(byId.values());
      });
    } catch (err) {
      console.error('세트 구성품 조회 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 새 검색·사용자 변경 시 초기화 */
  const reset = useCallback(() => setSiblings([]), []);

  // ── 검색 결과 ∪ 형제 (검색 결과 행이 우선 — 같은 id 면 검색 결과 객체 사용) ──
  const allItems = useMemo(() => {
    if (siblings.length === 0) return activeItems;
    const ids = new Set(activeItems.map((r) => r.id));
    const extra = siblings.filter((r) => !ids.has(r.id));
    return extra.length === 0 ? activeItems : [...activeItems, ...extra];
  }, [activeItems, siblings]);

  // ── product_id → 세트 구성품 전체 ──
  const partsByProductId = useMemo(() => {
    const map = new Map<string, FtOrderItem[]>();
    for (const r of allItems) {
      const key = setInstanceKeyOf(r);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return map;
  }, [allItems]);

  return { allItems, partsByProductId, loadForRows, reset, loading };
}
