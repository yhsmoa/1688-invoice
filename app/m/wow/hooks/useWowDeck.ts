'use client';

import { useCallback, useRef, useState } from 'react';
import type { WowWorkCard, WowWorkDeck } from '../../../storage/types';
import { fetchWorkDeck, postWork, SAVE_RETRIES, type WorkCardRef } from '../utils/wowWorkApi';

// ============================================================
// useWowDeck — 박스 하나의 카드 + 저장
//
//   · reload   : 서버에서 카드를 새로 받는다. 받을 때마다 loadSeq 가 1 늘어난다
//                (화면이 "지금 보던 카드 자리" 를 다시 맞추는 신호).
//                받는 동안에는 가지고 있던 카드를 그대로 둔다 — 응답이 오면 바꿔 끼운다 (화면이 비지 않는다)
//   · find     : [찾음] · [부족] · 취소(null) 를 서버에 저장만 한다.
//                위치 카드에서 몫보다 적게 꺼내면 나머지가 다른 카드로 다시 나오므로,
//                저장한 뒤에는 부르는 쪽이 reload 로 카드를 새로 받는다 (여기서 카드를 고쳐 넣지 않는다)
//   · saveMemo : 메모 저장 ('' = 지움). 메모는 카드 구성을 바꾸지 않아 그 카드만 고쳐 넣는다
//   · changeSize : 담는 박스의 크기 변경. 카드는 그대로라 박스의 크기만 고쳐 넣는다
//   · complete : [작업완료]
//
//   보내는 몫(plan_qty)은 항상 받은 카드의 값 그대로다 (표시한 "여기엔 없음" 카드는 0 일 수 있다).
//   실패는 그대로 던진다 (WowWorkError).
// ============================================================

/** 박스 크기 변경 결과 — prev = 바꾸기 전 크기(없었으면 null) · changed = 실제로 바뀌었는지 */
export interface SizeChange {
  prev: string | null;
  size: string;
  changed: boolean;
}

const cardRef = (card: WowWorkCard): WorkCardRef => ({
  product_id: card.product_id,
  location_id: card.location_id,
  plan_qty: card.plan_qty,
});

export function useWowDeck(boxId: string, operatorName: string) {
  const [deck, setDeck] = useState<WowWorkDeck | null>(null);
  const [loadSeq, setLoadSeq] = useState(0);
  const latestRef = useRef<WowWorkDeck | null>(null);
  const requestRef = useRef(0);

  const commit = useCallback((next: WowWorkDeck) => {
    latestRef.current = next;
    setDeck(next);
  }, []);

  // ── 서버에서 새로 받기 (요청이 겹치면 마지막 것만 쓴다) ──
  const reload = useCallback(async (): Promise<WowWorkDeck> => {
    requestRef.current += 1;
    const my = requestRef.current;
    const data = await fetchWorkDeck(boxId);
    if (my === requestRef.current) {
      commit(data);
      setLoadSeq((n) => n + 1);
    }
    return data;
  }, [boxId, commit]);

  // ── 박스에 들어옴 (신규 → 작업중) ──
  const open = useCallback(async (): Promise<void> => {
    await postWork(boxId, operatorName, { action: 'open' });
  }, [boxId, operatorName]);

  // ── 찾음 · 부족 · 취소 (저장만 — 카드는 부르는 쪽이 새로 받는다) ──
  const find = useCallback(async (card: WowWorkCard, foundQty: number | null): Promise<void> => {
    await postWork(boxId, operatorName, { action: 'find', ...cardRef(card), found_qty: foundQty }, SAVE_RETRIES);
  }, [boxId, operatorName]);

  // ── 메모 (서버가 앞뒤 빈칸을 다듬어 돌려준 값으로 그 카드만 고친다) ──
  const saveMemo = useCallback(async (card: WowWorkCard, memo: string): Promise<void> => {
    const res = await postWork(boxId, operatorName, { action: 'memo', ...cardRef(card), memo }, SAVE_RETRIES);
    const saved = typeof res.memo === 'string' && res.memo ? res.memo : null;
    const cur = latestRef.current;
    if (!cur) return;
    const patch: Partial<WowWorkCard> = {
      memo: saved,
      memo_by: saved ? operatorName : null,
      memo_at: saved ? new Date().toISOString() : null,
    };
    commit({ ...cur, cards: cur.cards.map((c) => (c.key === card.key ? { ...c, ...patch } : c)) });
  }, [boxId, operatorName, commit]);

  // ── 박스 크기 변경 (서버가 돌려준 크기로 머리의 크기만 고친다) ──
  const changeSize = useCallback(async (boxSize: string): Promise<SizeChange> => {
    const res = await postWork(boxId, operatorName, { action: 'size', box_size: boxSize }, SAVE_RETRIES);
    const size = typeof res.size === 'string' && res.size ? res.size : boxSize;
    const prev = typeof res.prev === 'string' && res.prev ? res.prev : null;
    const cur = latestRef.current;
    if (cur) commit({ ...cur, box: { ...cur.box, box_size: size } });
    return { prev, size, changed: res.changed === true };
  }, [boxId, operatorName, commit]);

  // ── 작업완료 ──
  const complete = useCallback(async (): Promise<void> => {
    await postWork(boxId, operatorName, { action: 'complete' });
  }, [boxId, operatorName]);

  return { deck, loadSeq, reload, open, find, saveMemo, changeSize, complete };
}
