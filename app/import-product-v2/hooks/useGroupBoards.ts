import { useMemo } from 'react';
import type { FtOrderItem } from './useFtData';
import { buildGroupBoards, flattenBoards, type GroupBoard } from '../utils/groupBoards';

// ============================================================
// useGroupBoards — 상품입고 V2 그룹(보드) 구성 메모
//
//   items 가 바뀔 때만 보드를 다시 만든다. 반환값:
//     boards        : 정렬된 보드 (utils/groupBoards.buildGroupBoards)
//     flatItems     : 보드 순서대로 펼친 행 — 테이블 정렬의 단일 출처
//     boardKeyOfRow : item.id → 보드 키 (페이지를 그룹 경계에서 끊는 데 쓴다)
//   검색 결과·페이지 조각은 utils/groupBoards.boardsForRows 로 다시 묶는다.
// ============================================================
export function useGroupBoards(items: FtOrderItem[]): {
  boards: GroupBoard[];
  flatItems: FtOrderItem[];
  boardKeyOfRow: Map<string, string>;
} {
  return useMemo(() => {
    const boards = buildGroupBoards(items);
    const boardKeyOfRow = new Map<string, string>();
    for (const b of boards) for (const r of b.rows) boardKeyOfRow.set(r.id, b.key);
    return { boards, flatItems: flattenBoards(boards), boardKeyOfRow };
  }, [items]);
}
