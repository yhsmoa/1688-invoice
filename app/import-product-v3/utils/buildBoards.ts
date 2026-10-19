import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import {
  cardKeyOf,
  compareText,
  normOpt,
  offerKeyOf,
  optionKeyOf,
  remainingOf,
  setInstanceKeyOf,
  EMPTY_OPT,
} from './groupKeys';

// ============================================================
// 상품입고 V3 — 카드 · 옵션 · 보드 구성 (순수 함수)
//
//   1) 행 → 카드(오퍼+색상) → 옵션(사이즈) 로 적재. 첫 등장 순서 유지
//   2) 세트 인스턴스(product_id) 를 공유하는 카드끼리 union-find 로 묶어 "보드" 를 만든다
//      — 화이트·블랙이 세트면 P 주문 46건으로 46번 연결돼도 결과는 보드 1개
//   3) 보드 안 카드 순서 = 카드 행들의 최소 set_seq (SET 1/2 화이트 → 2/2 블랙)
//   4) 옵션 순서 = 사이즈 숫자 인식 사전순, 옵션 안 행 순서 = item_no 순 (배분 순서)
// ============================================================

// ============================================================
// 타입
// ============================================================
export type OptionStatus = 'done' | 'partial' | 'none';

export interface OptionGroup {
  /** 카드 안에서 고유 (사이즈 원문) */
  key: string;
  /** 표시용 사이즈 ('-' 이면 사이즈 없음) */
  size: string;
  /** item_no 순 — 배분 순서 */
  rows: FtOrderItem[];
  orderTotal: number;
  arrivedTotal: number;
  remainingTotal: number;
}

export interface Card {
  key: string;
  offerKey: string;
  /** 색상 원문 (china_option1) */
  color: string;
  imgUrl: string | null;
  title: string;
  siteUrl: string | null;
  offerId: string | null;
  rows: FtOrderItem[];
  options: OptionGroup[];
  /** 카드 행들의 최소 set_seq — 세트 구성품 순서 (단품이면 null) */
  setSeq: number | null;
  /** 세트 구성품 수 (set_total 최대값 — 단품이면 null) */
  setTotal: number | null;
  /** 이 카드의 행 중 세트 행이 있는가 */
  hasSet: boolean;
  orderTotal: number;
  remainingTotal: number;
}

export interface Board {
  key: string;
  cards: Card[];
  /** 카드 2장 이상이 세트로 묶였는가 (카드 1장짜리 세트는 false — 테두리 묶음 불필요) */
  isSet: boolean;
  rows: FtOrderItem[];
}

// ============================================================
// 옵션 식별자 — 보드 안에서 고유 (카드 키 + 사이즈)
// ============================================================
export function optionIdOf(cardKey: string, optionKey: string): string {
  return `${cardKey}::${optionKey}`;
}

// ============================================================
// 상태 판정 — DB 기준 (저장된 입고만 반영)
//   done    : 남은 수량 없음
//   partial : 입고된 게 있는데 아직 남음 (덜 들어옴)
//   none    : 아직 작업 전
// ============================================================
export function optionDbStatus(opt: Pick<OptionGroup, 'rows' | 'arrivedTotal' | 'remainingTotal'>): OptionStatus {
  if (opt.rows.length > 0 && opt.remainingTotal === 0) return 'done';
  if (opt.arrivedTotal > 0 && opt.remainingTotal > 0) return 'partial';
  return 'none';
}

/** 여러 옵션 상태 합치기 — 모두 done → done, 하나라도 partial → partial */
export function mergeStatus(list: OptionStatus[]): OptionStatus {
  if (list.length === 0) return 'none';
  if (list.every((s) => s === 'done')) return 'done';
  if (list.some((s) => s === 'partial' || s === 'done')) return 'partial';
  return 'none';
}

// ============================================================
// union-find (카드 키 단위)
// ============================================================
function createUnionFind() {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    // 경로 압축
    let cur = x;
    while (parent.has(cur) && parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  return { find, add, union };
}

// ============================================================
// 보드 구성
// ============================================================
export function buildBoards(
  items: FtOrderItem[],
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): Board[] {
  // ── 1) 카드 → 옵션 적재 (첫 등장 순서) ──
  const cardOrder: string[] = [];
  const cardRows = new Map<string, FtOrderItem[]>();
  for (const it of items) {
    const key = cardKeyOf(it);
    if (!cardRows.has(key)) {
      cardRows.set(key, []);
      cardOrder.push(key);
    }
    cardRows.get(key)!.push(it);
  }

  // ── 2) 세트 인스턴스로 카드 연결 ──
  const uf = createUnionFind();
  const firstCardOfSet = new Map<string, string>();
  for (const key of cardOrder) uf.add(key);
  for (const it of items) {
    const setKey = setInstanceKeyOf(it);
    if (!setKey) continue;
    const cardKey = cardKeyOf(it);
    const first = firstCardOfSet.get(setKey);
    if (first) uf.union(first, cardKey);
    else firstCardOfSet.set(setKey, cardKey);
  }

  // ── 3) 카드 객체 생성 ──
  const cards = new Map<string, Card>();
  for (const key of cardOrder) {
    const rows = cardRows.get(key)!;
    const optionOrder: string[] = [];
    const optionRows = new Map<string, FtOrderItem[]>();
    for (const r of rows) {
      const ok = optionKeyOf(r);
      if (!optionRows.has(ok)) {
        optionRows.set(ok, []);
        optionOrder.push(ok);
      }
      optionRows.get(ok)!.push(r);
    }

    const options: OptionGroup[] = optionOrder
      .map((ok) => {
        const optRows = [...optionRows.get(ok)!].sort((a, b) => compareText(a.item_no, b.item_no));
        let orderTotal = 0;
        let arrivedTotal = 0;
        let remainingTotal = 0;
        for (const r of optRows) {
          orderTotal += r.order_qty ?? 0;
          arrivedTotal += arrivalMap.get(r.id) ?? 0;
          remainingTotal += remainingOf(r, arrivalMap, cancelMap);
        }
        return { key: ok, size: ok, rows: optRows, orderTotal, arrivedTotal, remainingTotal };
      })
      // 사이즈 없음('-') 은 맨 뒤
      .sort((a, b) => {
        if (a.key === EMPTY_OPT && b.key !== EMPTY_OPT) return 1;
        if (b.key === EMPTY_OPT && a.key !== EMPTY_OPT) return -1;
        return compareText(a.key, b.key);
      });

    const setSeqs = rows
      .filter((r) => setInstanceKeyOf(r))
      .map((r) => r.set_seq)
      .filter((v): v is number => v != null);
    const first = rows[0];

    cards.set(key, {
      key,
      offerKey: offerKeyOf(first),
      color: normOpt(first.china_option1) || EMPTY_OPT,
      imgUrl: rows.find((r) => r.img_url)?.img_url ?? null,
      title: rows.find((r) => r.item_name)?.item_name ?? '',
      siteUrl: rows.find((r) => r.site_url)?.site_url ?? null,
      offerId: normOpt(first['1688_offer_id']) || null,
      rows,
      options,
      setSeq: setSeqs.length > 0 ? Math.min(...setSeqs) : null,
      setTotal: rows.some((r) => setInstanceKeyOf(r) !== null)
        ? Math.max(...rows.filter((r) => setInstanceKeyOf(r) !== null).map((r) => r.set_total ?? 0))
        : null,
      hasSet: rows.some((r) => setInstanceKeyOf(r) !== null),
      orderTotal: options.reduce((n, o) => n + o.orderTotal, 0),
      remainingTotal: options.reduce((n, o) => n + o.remainingTotal, 0),
    });
  }

  // ── 4) 보드 = union-find 루트별 카드 묶음 (첫 카드 등장 순서) ──
  const boardOrder: string[] = [];
  const boardCards = new Map<string, Card[]>();
  for (const key of cardOrder) {
    const root = uf.find(key);
    if (!boardCards.has(root)) {
      boardCards.set(root, []);
      boardOrder.push(root);
    }
    boardCards.get(root)!.push(cards.get(key)!);
  }

  return boardOrder.map((root) => {
    const list = boardCards.get(root)!;
    // 카드 순서: 최소 set_seq → 등장 순서 (Array.sort 는 안정 정렬)
    const sorted = [...list].sort((a, b) => (a.setSeq ?? Infinity) - (b.setSeq ?? Infinity));
    return {
      key: sorted[0].key,
      cards: sorted,
      isSet: sorted.length > 1 && sorted.some((c) => c.hasSet),
      rows: sorted.flatMap((c) => c.rows),
    };
  });
}
