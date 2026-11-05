import type { FtOrderItem } from '../hooks/useFtData';
import { resolveSizeBadge, type SizeBadge } from '../../../lib/sizeCode';
import {
  compareText,
  normOpt,
  offerKeyOf,
  remainingOf,
  EMPTY_OPT,
} from './groupKeys';

// ============================================================
// 상품입고 V2 — 그룹(보드) 구성 · 정렬 · 그룹입력 배분 (순수 함수)
//
// 그룹 = 타입(P/A/B/C/X) + 1688 오퍼 + 중국옵션1 + 중국옵션2
//   · P 와 A 는 같은 상품·옵션이어도 다른 그룹 (사용자 요구 15)
//   · 세트(set_total > 1) 는 옵션으로 쪼개지 않고 "구성이 같은 세트끼리" 한 그룹
//       세트 인스턴스 = product_id (구성품 n행이 공유)
//       세트 서명    = set_seq 순으로 (오퍼|옵션1|옵션2) 를 이은 문자열
//
// 정렬 (테이블 평면 보기 · 보드 보기가 같은 순서)
//   1. 타입 P → A → B → C → X → 그 외 (TYPE_RANK)
//   2. 상품(타입+오퍼) 의 첫 글번호(item_no) 가 앞선 상품 먼저
//   3. 같은 상품 안에서는 옵션1 → 옵션2 를 사이즈 규칙(compareOption)으로 (黑色 130 → 黑色 140 → 黑色 150)
//   4. 그룹 안 행은 글번호 순 (세트는 인스턴스 글번호 순 → set_seq 순)
//
// 오퍼 키·옵션 정규화·글번호 비교는 utils/groupKeys (V2·V3 공용) 에서만 정의한다.
// ============================================================

// ============================================================
// 옵션 정렬 — DB 에 실제로 들어오는 중국옵션 형태를 기준으로 정했다
//
//   숫자 사이즈 : 120cm · 130 · 140码-建议身高130-140厘米 · 10Y · 13号适合115-120cm
//   문자 사이즈 : S · M · L · XL · 2XL · XXL · L【建议101-120斤】 · 妈妈L · 爸爸3XL · 45-55kg/M
//   프리        : 均码 · FREE · 均码【F】 · 277均码 · 均码SN-250483
//   그 외       : 색상(黑色 · 灰色 · HW36) · 大码 — 숫자가 있으면 숫자, 없으면 글자 순
//
// 규칙 (위에서부터 먼저 맞는 것)
//   1) 均码 / FREE / ONE SIZE 포함              → 프리   (맨 뒤)
//   2) 라틴 글자에 붙지 않은 S/M/L/XL/2XL… 토큰  → 문자   (XS < S < M < L < XL < 2XL …)
//      "130cm" 의 m, "2码=ML" 의 M/L 처럼 다른 라틴 글자에 붙은 건 토큰이 아니다
//   3) 첫 숫자                                   → 숫자   (120 < 130 < 1000)
//   4) 나머지                                    → 글자 순
//   같은 계열끼리만 순위를 비교하고, 계열이 다르면 숫자 → 문자 → 프리 → 그 외 순.
//   동률이면 원문 글자 순 (numeric 인식) 으로 안정 정렬.
// ============================================================
type OptionFamily = 0 | 1 | 2 | 3; // 0 숫자 · 1 문자 · 2 프리 · 3 그 외

interface OptionRank {
  family: OptionFamily;
  rank: number;
  text: string;
}

const LETTER_RANK: Record<string, number> = {
  XXXS: 1, XXS: 2, XS: 3, S: 4, M: 5, L: 6, XL: 7,
  XXL: 8, '2XL': 8, XXXL: 9, '3XL': 9, XXXXL: 10, '4XL': 10,
  '5XL': 11, '6XL': 12, '7XL': 13, '8XL': 14, '9XL': 15,
};
const LETTER_RE = /(?<![A-Za-z])(XXXS|XXS|XS|XXXXL|XXXL|XXL|XL|[2-9]XL|S|M|L)(?![A-Za-z])/i;
const FREE_RE = /均码|均碼|均號|free|one\s*size/i;
const NUM_RE = /\d+(?:\.\d+)?/;

export function optionRankOf(raw: string | null | undefined): OptionRank {
  const text = normOpt(raw);
  if (!text) return { family: 3, rank: 0, text: '' };
  if (FREE_RE.test(text)) return { family: 2, rank: 0, text };
  const letter = text.match(LETTER_RE);
  if (letter) return { family: 1, rank: LETTER_RANK[letter[1].toUpperCase()] ?? 99, text };
  const num = text.match(NUM_RE);
  if (num) return { family: 0, rank: parseFloat(num[0]), text };
  return { family: 3, rank: 0, text };
}

/** 옵션 문자열 비교 — 사이즈 순서를 알면 그 순서로, 모르면 글자 순 */
export function compareOption(a: string | null | undefined, b: string | null | undefined): number {
  const ra = optionRankOf(a);
  const rb = optionRankOf(b);
  if (ra.family !== rb.family) return ra.family - rb.family;
  if ((ra.family === 0 || ra.family === 1) && ra.rank !== rb.rank) return ra.rank - rb.rank;
  return compareText(ra.text, rb.text);
}

// ============================================================
// 타입
// ============================================================
export interface GroupComponent {
  /** set_seq */
  seq: number;
  option1: string;
  option2: string;
  imgUrl: string | null;
  itemName: string;
  /** 세트 인스턴스 글번호 순 */
  rows: FtOrderItem[];
}

export interface GroupBoard {
  /** 보드 고유 키 (정렬·모달 입력 키로도 쓴다) */
  key: string;
  /** 타입 배지 P/A/B/C/X — 판정 불가면 null */
  badge: SizeBadge | null;
  isSet: boolean;
  /** 세트 구성품 수 (단품이면 null) */
  setTotal: number | null;
  /** 세트 인스턴스(product_id) 수 — 단품이면 0 */
  setInstanceCount: number;
  /** 같은 상품(타입+오퍼) 묶음 — 정렬용. 세트는 보드 키 */
  productKey: string;
  option1: string;
  option2: string;
  imgUrl: string | null;
  itemName: string;
  /** 정렬된 행 (세트: 인스턴스 글번호 순 → set_seq 순) */
  rows: FtOrderItem[];
  /** 세트 구성품 (set_seq 순) — 단품 보드는 [] */
  components: GroupComponent[];
}

// ============================================================
// 내부 헬퍼
// ============================================================
/** 타입 정렬 순서 — P(개인) 먼저, 그 다음 쿠팡 A/B/C, 직송 X, 그 외 */
const TYPE_RANK: Record<string, number> = { P: 0, A: 1, B: 2, C: 3, X: 4 };
const typeRankOf = (badge: SizeBadge | null) => (badge ? TYPE_RANK[badge.code] ?? 5 : 6);

function typeCodeOf(row: FtOrderItem): { code: string; badge: SizeBadge | null } {
  const badge = resolveSizeBadge(row.shipment_type, row.coupang_shipment_size);
  return { code: badge?.code ?? '-', badge };
}

function isSetRow(row: FtOrderItem): boolean {
  return (row.set_total ?? 0) > 1 && !!row.product_id;
}

const byItemNo = (a: FtOrderItem, b: FtOrderItem) => compareText(a.item_no, b.item_no);

function minItemNo(rows: FtOrderItem[]): string | null {
  let min: string | null = null;
  for (const r of rows) {
    if (!r.item_no) continue;
    if (min === null || compareText(r.item_no, min) < 0) min = r.item_no;
  }
  return min;
}

// ============================================================
// 보드 구성
// ============================================================
export function buildGroupBoards(items: FtOrderItem[]): GroupBoard[] {
  // ── 1) 세트 인스턴스 수집 (product_id 단위) ──
  const instances = new Map<string, FtOrderItem[]>();
  const singles: FtOrderItem[] = [];
  for (const row of items) {
    if (isSetRow(row)) {
      const list = instances.get(row.product_id!) ?? [];
      list.push(row);
      instances.set(row.product_id!, list);
    } else {
      singles.push(row);
    }
  }

  const boards = new Map<string, GroupBoard>();

  // ── 2) 세트 보드 — 구성 서명이 같은 인스턴스끼리 ──
  type Instance = { rows: FtOrderItem[]; rank: string | null };
  const instancesByBoard = new Map<string, Instance[]>();

  instances.forEach((rows) => {
    rows.sort((a, b) => (a.set_seq ?? 0) - (b.set_seq ?? 0) || byItemNo(a, b));
    const first = rows[0];
    const { code, badge } = typeCodeOf(first);
    const signature = rows
      .map((r) => `${r.set_seq ?? 0}:${offerKeyOf(r)}|${normOpt(r.china_option1)}|${normOpt(r.china_option2)}`)
      .join('+');
    const key = `${code}|set|${signature}`;

    if (!boards.has(key)) {
      boards.set(key, {
        key,
        badge,
        isSet: true,
        setTotal: first.set_total ?? null,
        setInstanceCount: 0,
        productKey: key,
        option1: '',
        option2: '',
        imgUrl: first.img_url ?? null,
        itemName: first.item_name ?? '',
        rows: [],
        components: [],
      });
    }
    const list = instancesByBoard.get(key) ?? [];
    list.push({ rows, rank: minItemNo(rows) });
    instancesByBoard.set(key, list);
  });

  instancesByBoard.forEach((list, key) => {
    const board = boards.get(key)!;
    list.sort((a, b) => compareText(a.rank, b.rank));
    board.setInstanceCount = list.length;
    const compBySeq = new Map<number, GroupComponent>();
    for (const inst of list) {
      for (const row of inst.rows) {
        board.rows.push(row);
        const seq = row.set_seq ?? 0;
        let comp = compBySeq.get(seq);
        if (!comp) {
          comp = {
            seq,
            option1: normOpt(row.china_option1),
            option2: normOpt(row.china_option2),
            imgUrl: row.img_url ?? null,
            itemName: row.item_name ?? '',
            rows: [],
          };
          compBySeq.set(seq, comp);
        }
        comp.rows.push(row);
      }
    }
    board.components = Array.from(compBySeq.values()).sort((a, b) => a.seq - b.seq);
  });

  // ── 3) 단품 보드 — 타입 + 오퍼 + 옵션1 + 옵션2 ──
  for (const row of singles) {
    const { code, badge } = typeCodeOf(row);
    const offer = offerKeyOf(row);
    const option1 = normOpt(row.china_option1);
    const option2 = normOpt(row.china_option2);
    const productKey = `${code}|${offer}`;
    const key = `${productKey}|${option1 || EMPTY_OPT}|${option2 || EMPTY_OPT}`;
    let board = boards.get(key);
    if (!board) {
      board = {
        key,
        badge,
        isSet: false,
        setTotal: null,
        setInstanceCount: 0,
        productKey,
        option1,
        option2,
        imgUrl: row.img_url ?? null,
        itemName: row.item_name ?? '',
        rows: [],
        components: [],
      };
      boards.set(key, board);
    }
    board.rows.push(row);
  }

  // ── 4) 정렬 ──
  const list = Array.from(boards.values());
  const productRank = new Map<string, string | null>();
  const boardRank = new Map<string, string | null>();
  for (const b of list) {
    if (!b.isSet) b.rows.sort(byItemNo);
    const rank = minItemNo(b.rows);
    boardRank.set(b.key, rank);
    const prev = productRank.get(b.productKey);
    if (prev === undefined || compareText(rank, prev) < 0) productRank.set(b.productKey, rank);
  }

  list.sort((a, b) => {
    // 0) 타입 P → A → B → C → X
    const tr = typeRankOf(a.badge) - typeRankOf(b.badge);
    if (tr !== 0) return tr;
    // 1) 상품 첫 글번호
    const pr = compareText(productRank.get(a.productKey) ?? null, productRank.get(b.productKey) ?? null);
    if (pr !== 0) return pr;
    if (a.productKey !== b.productKey) return a.productKey.localeCompare(b.productKey);
    // 2) 같은 상품 안 옵션 순서
    const o1 = compareOption(a.option1, b.option1);
    if (o1 !== 0) return o1;
    const o2 = compareOption(a.option2, b.option2);
    if (o2 !== 0) return o2;
    // 3) 그래도 같으면 보드 첫 글번호
    return compareText(boardRank.get(a.key) ?? null, boardRank.get(b.key) ?? null);
  });

  return list;
}

/** 보드 순서대로 행을 펼친 목록 — 테이블 평면 보기의 정렬 결과 */
export function flattenBoards(boards: GroupBoard[]): FtOrderItem[] {
  const out: FtOrderItem[] = [];
  for (const b of boards) out.push(...b.rows);
  return out;
}

// ============================================================
// 부분 행 목록 → 보드
//   검색 결과·페이지 조각처럼 전체의 일부만 가진 행 목록을 보드 단위로 다시 묶는다.
//   rows 는 flattenBoards 순서를 유지한 부분집합이어야 한다 (연속 구간 = 한 보드).
//   같은 보드가 떨어져서 두 번 나오면 (페이지 경계 등) 두 보드로 나온다 — 기존
//   세트 묶음선과 같은 한계이며 순서는 깨지지 않는다.
// ============================================================
export function boardsForRows(boards: GroupBoard[], rows: FtOrderItem[]): GroupBoard[] {
  const indexOfRow = new Map<string, number>();
  boards.forEach((b, i) => b.rows.forEach((r) => indexOfRow.set(r.id, i)));

  const out: GroupBoard[] = [];
  let current: { src: number; rows: FtOrderItem[] } | null = null;
  const flush = () => {
    if (!current) return;
    const src = boards[current.src];
    const ids = new Set(current.rows.map((r) => r.id));
    out.push({
      ...src,
      rows: current.rows,
      components: src.components
        .map((c) => ({ ...c, rows: c.rows.filter((r) => ids.has(r.id)) }))
        .filter((c) => c.rows.length > 0),
      setInstanceCount: src.isSet
        ? new Set(current.rows.map((r) => r.product_id)).size
        : 0,
    });
    current = null;
  };

  for (const row of rows) {
    const idx = indexOfRow.get(row.id);
    if (idx === undefined) {
      // 보드에 없는 행(데이터 소스가 다른 경우) — 단독 보드로 보여 준다
      flush();
      out.push({
        key: `row|${row.id}`,
        badge: typeCodeOf(row).badge,
        isSet: false,
        setTotal: null,
        setInstanceCount: 0,
        productKey: `row|${row.id}`,
        option1: normOpt(row.china_option1),
        option2: normOpt(row.china_option2),
        imgUrl: row.img_url ?? null,
        itemName: row.item_name ?? '',
        rows: [row],
        components: [],
      });
      continue;
    }
    if (current && current.src === idx) {
      current.rows.push(row);
    } else {
      flush();
      current = { src: idx, rows: [row] };
    }
  }
  flush();
  return out;
}

// ============================================================
// 그룹입력 — 수량 배분
//   한 그룹에 입력한 수량을 행 순서(글번호 순)대로 잔여 한도까지 채워 나눈다.
//   잔여 = order_qty − ARRIVAL − CANCEL (테이블 작업 셀 입력 한도와 같은 공식)
// ============================================================
export function remainingQtyOf(
  row: FtOrderItem,
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): number {
  return remainingOf(row, arrivalMap, cancelMap);
}

export function distributeQty(
  rows: FtOrderItem[],
  qty: number,
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  let left = Math.max(0, Math.floor(qty));
  for (const row of rows) {
    if (left <= 0) break;
    const rem = remainingQtyOf(row, arrivalMap, cancelMap);
    if (rem <= 0) continue;
    const take = Math.min(rem, left);
    out.set(row.id, take);
    left -= take;
  }
  return out;
}

// ============================================================
// 세트 불일치 판정
//   세트 인스턴스(product_id) 안에서 구성품별 (입고 + 작업) 이 서로 다르면 불일치.
//   이미 저장된 입고만으로 어긋난 세트(3,2,3 처럼 한 피스가 덜 들어온 것)도 잡아야 하므로
//   작업 수량 입력 여부와 무관하게 모든 인스턴스를 본다.
//   검색으로 구성품 일부만 보이는 세트는 보이는 구성품끼리만 비교한다.
// ============================================================
export interface SetMismatchPart {
  itemNo: string | null;
  seq: number;
  option1: string;
  option2: string;
  arrival: number;
  work: number;
}

export interface SetMismatch {
  productId: string;
  orderNo: string | null;
  productNo: string | null;
  setTotal: number | null;
  parts: SetMismatchPart[];
}

/**
 * 세트 부족 — 구성품끼리 (입고 + 작업) 은 맞는데 주문 수량보다 적게 들어온 인스턴스
 *   (세트 불일치가 아니라 "덜 들어온" 상태 — 주황 배지). 아직 하나도 안 들어온 세트는 제외.
 */
export function findSetShortages(
  boards: GroupBoard[],
  workMap: Map<string, number>,
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): SetMismatch[] {
  const out: SetMismatch[] = [];
  for (const board of boards) {
    if (!board.isSet) continue;
    const byInstance = new Map<string, FtOrderItem[]>();
    for (const row of board.rows) {
      const list = byInstance.get(row.product_id!) ?? [];
      list.push(row);
      byInstance.set(row.product_id!, list);
    }
    byInstance.forEach((rows, productId) => {
      if (rows.length < 2) return;
      const parts: SetMismatchPart[] = rows.map((r) => ({
        itemNo: r.item_no,
        seq: r.set_seq ?? 0,
        option1: normOpt(r.china_option1),
        option2: normOpt(r.china_option2),
        arrival: arrivalMap.get(r.id) ?? 0,
        work: workMap.get(r.id) ?? 0,
      }));
      const totals = parts.map((p) => p.arrival + p.work);
      const equal = totals.every((v) => v === totals[0]);
      if (!equal || totals[0] <= 0) return;
      const short = rows.some((r, i) => totals[i] < (r.order_qty ?? 0) - (cancelMap.get(r.id) ?? 0));
      if (!short) return;
      out.push({ productId, orderNo: rows[0].order_no, productNo: rows[0].product_no, setTotal: rows[0].set_total ?? null, parts });
    });
  }
  return out;
}

export function findSetMismatches(
  boards: GroupBoard[],
  workMap: Map<string, number>,
  arrivalMap: Map<string, number>
): SetMismatch[] {
  const out: SetMismatch[] = [];
  for (const board of boards) {
    if (!board.isSet) continue;
    const byInstance = new Map<string, FtOrderItem[]>();
    for (const row of board.rows) {
      const list = byInstance.get(row.product_id!) ?? [];
      list.push(row);
      byInstance.set(row.product_id!, list);
    }
    byInstance.forEach((rows, productId) => {
      if (rows.length < 2) return;
      const parts: SetMismatchPart[] = rows.map((r) => ({
        itemNo: r.item_no,
        seq: r.set_seq ?? 0,
        option1: normOpt(r.china_option1),
        option2: normOpt(r.china_option2),
        arrival: arrivalMap.get(r.id) ?? 0,
        work: workMap.get(r.id) ?? 0,
      }));
      const totals = parts.map((p) => p.arrival + p.work);
      if (totals.every((v) => v === totals[0])) return;
      out.push({
        productId,
        orderNo: rows[0].order_no,
        productNo: rows[0].product_no,
        setTotal: rows[0].set_total ?? null,
        parts,
      });
    });
  }
  return out;
}
