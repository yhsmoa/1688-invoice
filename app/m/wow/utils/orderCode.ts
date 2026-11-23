// ============================================================
// 박스 라벨 번호 읽기 — "발주번호-박스번호" (예: 148124410-2)
//
//   · 148124410-2  → 발주번호 148124410 · 박스 2            (라벨에 찍힌 그대로)
//   · 148124410    → 발주번호만 (목록을 그 발주번호로 거른다)
//   · 1481244102   → 하이픈 없이 쳐도 된다: 목록에 있는 발주번호가 앞부분과 같고
//                    뒤에 1~2자리가 남으면 그 자리를 박스번호로 본다
// ============================================================

/** 발주번호로 보는 최소 자릿수 */
const MIN_ORDER_DIGITS = 5;
/** 하이픈 없이 붙여 쳤을 때 박스번호로 보는 최대 자릿수 */
const MAX_JOINED_BOX_DIGITS = 2;
/** 목록 거르기를 시작하는 최소 자릿수 */
const MIN_FILTER_DIGITS = 3;

const LABEL_RE = new RegExp(`^(\\d{${MIN_ORDER_DIGITS},})-(\\d+)$`);
const ORDER_RE = new RegExp(`^\\d{${MIN_ORDER_DIGITS},}$`);
const FILTER_RE = new RegExp(`^\\d{${MIN_FILTER_DIGITS},}(-\\d*)?$`);

export interface OrderCode {
  orderNumber: string;
  /** null = 발주번호만 */
  boxNo: number | null;
}

const compact = (raw: string): string => String(raw ?? '').replace(/\s+/g, '');

/** 화면에 보이는 박스 이름 = 라벨에 찍힌 모양 그대로 */
export const boxLabel = (box: { order_number: string; box_no: number }): string => `${box.order_number}-${box.box_no}`;

// ── 입력 · 스캔 값 → 발주번호 + 박스번호 (형식이 아니면 null) ──
export function parseOrderCode(raw: string, knownOrderNumbers: string[]): OrderCode | null {
  const s = compact(raw);

  const label = s.match(LABEL_RE);
  if (label) return { orderNumber: label[1], boxNo: Number(label[2]) };
  if (!ORDER_RE.test(s)) return null;

  const known = Array.from(new Set(knownOrderNumbers));
  if (known.includes(s)) return { orderNumber: s, boxNo: null };

  // 하이픈 없이 붙여 친 값 — 가장 긴 발주번호부터 맞춰 본다
  const hit = known
    .filter((no) => s.startsWith(no) && s.length > no.length && s.length - no.length <= MAX_JOINED_BOX_DIGITS)
    .sort((a, b) => b.length - a.length)[0];
  if (hit) return { orderNumber: hit, boxNo: Number(s.slice(hit.length)) };

  return { orderNumber: s, boxNo: null };
}

// ── 입력 칸의 값 → 목록을 거를 발주번호 (거를 만큼 길지 않으면 '') ──
export function filterOf(input: string): string {
  const s = compact(input);
  return FILTER_RE.test(s) ? s.split('-')[0] : '';
}

/** 그 발주번호가 거르기 값에 걸리는가 (박스번호까지 붙여 친 값도 걸리게 앞부분 비교 포함) */
export function matchesFilter(orderNumber: string, filter: string): boolean {
  return orderNumber.includes(filter) || (filter.length > orderNumber.length && filter.startsWith(orderNumber));
}
