'use client';

import { useCallback, useRef, useState } from 'react';
import type { WowWorkBox } from '../../../storage/types';
import { fetchWorkBoxes } from '../utils/wowWorkApi';

// ============================================================
// useWowBoxes — 작업할 박스 목록
//
//   · boxes = null 이면 아직 한 번도 받지 못한 것 (화면은 "불러오는 중")
//   · 새로 받는 동안에도 가지고 있던 목록은 그대로 보여 준다 (카드에서 돌아올 때마다
//     목록이 비었다 차면 느려 보인다) — 받은 뒤에 바꿔 끼운다
//   · 요청이 겹치면 마지막 요청의 결과만 쓴다
//   · 실패는 그대로 던진다 (문구 · 안내는 부르는 쪽이 정한다)
// ============================================================
export function useWowBoxes() {
  const [boxes, setBoxes] = useState<WowWorkBox[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seqRef = useRef(0);

  const reload = useCallback(async (): Promise<WowWorkBox[]> => {
    seqRef.current += 1;
    const my = seqRef.current;
    setRefreshing(true);
    try {
      const data = await fetchWorkBoxes();
      if (my === seqRef.current) setBoxes(data);
      return data;
    } finally {
      if (my === seqRef.current) setRefreshing(false);
    }
  }, []);

  // ── 박스 하나만 고쳐 넣기 (카드 화면에서 크기를 바꿨을 때 — 목록으로 돌아와 새로 받기 전에도 맞게 보이도록) ──
  const patchBox = useCallback((boxId: string, patch: Partial<WowWorkBox>) => {
    setBoxes((prev) => (prev ? prev.map((b) => (b.box_id === boxId ? { ...b, ...patch } : b)) : prev));
  }, []);

  return { boxes, refreshing, reload, patchBox };
}
