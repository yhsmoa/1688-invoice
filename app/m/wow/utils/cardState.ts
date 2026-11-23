import type { WowWorkBox, WowWorkCard } from '../../../storage/types';

// ============================================================
// 카드 · 박스의 표시 상태 계산 (화면 여러 곳이 같은 규칙을 쓰도록 한 곳에)
//
//   카드는 두 가지다.
//     · 위치 카드 (location_id 있음) : 그 위치에서 꺼낸다. 표시하면 "꺼냄 n개" (0 = 여기엔 없음).
//       몫보다 적게 꺼내면 나머지는 서버가 다른 위치 카드(또는 위치 없는 카드)로 다시 내준다
//     · 위치 없는 카드 (location_id null) : 어디에도 재고가 없는 몫 = 부족. 할 수 있는 일은 [부족 확인] 뿐
//   그래서 "부족" 은 표시한 위치 없는 카드만 센다 (목록의 short_cards 와 같은 뜻)
// ============================================================

/** taken = 위치 카드를 표시함(꺼냄) · short = 위치 없는 카드를 부족으로 확인함 · null = 아직 표시 안 함 */
export type CardStatus = 'taken' | 'short' | null;

/** 재고 위치가 있는 카드인가 */
export const hasLocation = (card: WowWorkCard): boolean => card.location_id !== null;

export function cardStatus(card: WowWorkCard): CardStatus {
  if (card.found_qty === null) return null;
  return hasLocation(card) ? 'taken' : 'short';
}

/**
 * 이 카드에 넣을 수 있는 꺼낸 수량의 최대.
 * 선반 카드는 그 선반에 잡아 둔 수량(plan_qty)까지 — 덜 나오면 모자란 몫은 서버가 다른 선반에 다시 잡는다.
 * 선반 없는 카드는 0 뿐이다.
 */
export const maxFoundQty = (card: WowWorkCard): number =>
  (hasLocation(card) ? Math.max(0, card.plan_qty) : 0);

// ── 카드 묶음 요약 ──
export interface DeckSummary {
  total: number;
  /** 표시한 위치 카드 · 부족으로 확인한 위치 없는 카드 · 아직 표시하지 않은 카드 */
  taken: number;
  short: number;
  left: number;
  /** 꺼낸 수량 합 · 부족 수량 합 (부족으로 확인한 카드의 몫) */
  takenQty: number;
  shortQty: number;
}

export function summarize(cards: WowWorkCard[]): DeckSummary {
  const s: DeckSummary = { total: cards.length, taken: 0, short: 0, left: 0, takenQty: 0, shortQty: 0 };
  for (const c of cards) {
    const status = cardStatus(c);
    if (status === 'taken') {
      s.taken += 1;
      s.takenQty += c.found_qty ?? 0;
    } else if (status === 'short') {
      s.short += 1;
      s.shortQty += c.plan_qty;
    } else {
      s.left += 1;
    }
  }
  return s;
}

// ── 아직 표시하지 않은 카드 찾기 (없으면 카드 수 = 정리 카드 자리) ──
export function firstUnmarked(cards: WowWorkCard[]): number {
  const i = cards.findIndex((c) => c.found_qty === null);
  return i < 0 ? cards.length : i;
}

export function nextUnmarked(cards: WowWorkCard[], from: number): number {
  for (let i = from + 1; i < cards.length; i += 1) {
    if (cards[i].found_qty === null) return i;
  }
  return cards.length;
}

// ── 목록의 박스 ──
/** 카드를 전부 표시한 박스 ([작업완료] 만 남음) */
export const isBoxMarked = (box: WowWorkBox): boolean => box.cards > 0 && box.found_cards + box.short_cards >= box.cards;

/** 입고예정일 'YYYY-MM-DD' → 'MM-DD' (없으면 '') */
export function formatMonthDay(date: string | null | undefined): string {
  const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : '';
}
