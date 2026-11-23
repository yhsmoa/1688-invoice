'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// useDeckScroll — 옆으로 넘기는 카드 묶음의 "지금 몇 번째" 관리
//
//   카드 묶음은 CSS scroll-snap 으로 한 장씩 멈춘다. 이 훅은
//     · 손으로 넘긴 뒤 멈춘 자리를 읽어 index 로 알려 주고
//     · goTo(i) 로 원하는 카드로 옮긴다 (instant = 움직임 없이 바로)
//     · 화면 크기가 바뀌면(가로/세로 돌림) 보던 카드에 다시 맞춘다
//   indexRef = 기다리는 동안(저장 중)에도 지금 자리를 알 수 있게 하는 값
// ============================================================

/** 넘기기가 멈췄다고 보는 시간 */
const SCROLL_SETTLE_MS = 80;

export function useDeckScroll(slideCount: number) {
  const deckRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const countRef = useRef(slideCount);
  countRef.current = slideCount;
  const settleTimerRef = useRef<number | null>(null);

  const setBoth = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
  }, []);

  // ── 원하는 카드로 ──
  const goTo = useCallback((i: number, instant = false) => {
    const target = Math.max(0, Math.min(countRef.current - 1, i));
    setBoth(target);
    const el = deckRef.current;
    if (el) el.scrollTo({ left: target * el.clientWidth, behavior: instant ? 'auto' : 'smooth' });
  }, [setBoth]);

  // ── 손으로 넘긴 뒤 멈춘 자리 읽기 ──
  const onScroll = useCallback(() => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      const el = deckRef.current;
      if (!el) return;
      const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      setBoth(Math.max(0, Math.min(countRef.current - 1, at)));
    }, SCROLL_SETTLE_MS);
  }, [setBoth]);

  // ── 화면 크기가 바뀌면 보던 카드에 다시 맞춤 · 나갈 때 정리 ──
  useEffect(() => {
    const onResize = () => {
      const el = deckRef.current;
      if (el) el.scrollTo({ left: indexRef.current * el.clientWidth, behavior: 'auto' });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return { deckRef, index, indexRef, goTo, onScroll };
}
