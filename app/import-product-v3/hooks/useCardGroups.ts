'use client';

import { useMemo } from 'react';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import { buildBoards, type Board } from '../utils/buildBoards';

// ============================================================
// 카드 그룹 — 표시할 행 → 보드[] (utils/buildBoards.ts 를 메모이즈)
//   arrivalMap / cancelMap 이 바뀌면(저장·취소 후 refresh) 잔여·상태가 다시 계산된다.
// ============================================================
export function useCardGroups(
  items: FtOrderItem[],
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): Board[] {
  return useMemo(() => buildBoards(items, arrivalMap, cancelMap), [items, arrivalMap, cancelMap]);
}
