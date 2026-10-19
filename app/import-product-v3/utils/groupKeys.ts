import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';

// ============================================================
// 상품입고 V3 — 그룹 키 (순수 함수)
//
//   카드   = (1688 오퍼 + 색상 china_option1)   → 이미지 1장
//   옵션   = 카드 안에서 사이즈(china_option2) 가 같은 주문행 묶음
//   세트   = set_total > 1 인 행의 product_id   → 세트 1벌(구성품 n행)
//
// 색상은 china_option1 "원문" 을 그대로 키로 쓴다. HW36 / HW37 처럼 색상명이
// 아닌 규격 코드가 들어와도 1688 의 1번 규격이므로 정규화·번역하지 않는다
// (잘못 묶이는 위험이 더 크다). 공백만 정리한다.
// ============================================================

// ── 키 계산에 필요한 최소 컬럼 (검증 스크립트에서 가짜 행으로 돌릴 수 있게) ──
export type GroupKeySource = Pick<
  FtOrderItem,
  'item_name' | 'site_url' | 'china_option1' | 'china_option2' | 'set_total' | 'product_id' | '1688_offer_id'
>;

/** 옵션 문자열 정리 — 연속 공백 1칸, 앞뒤 공백 제거, null → '' */
export function normOpt(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

// ── 1688 상품 URL 의 오퍼 번호 (offer_id 가 비어 있는 행의 대체 키) ──
const OFFER_URL_RE = /offer\/(\d+)/;

/** 오퍼 식별 — 1688_offer_id → site_url 의 offer 번호 → 상품명 순으로 대체 */
export function offerKeyOf(it: GroupKeySource): string {
  const offer = normOpt(it['1688_offer_id']);
  if (offer) return `offer:${offer}`;
  const match = it.site_url?.match(OFFER_URL_RE);
  if (match) return `offer:${match[1]}`;
  return `name:${normOpt(it.item_name)}`;
}

/** 빈 값 자리표시 — 색상/사이즈가 없는 행(ONE SIZE 등)도 한 그룹으로 모은다 */
export const EMPTY_OPT = '-';

/** 카드 키 = 오퍼 + 색상 */
export function cardKeyOf(it: GroupKeySource): string {
  return `${offerKeyOf(it)}|${normOpt(it.china_option1) || EMPTY_OPT}`;
}

/** 옵션 키 = 사이즈 */
export function optionKeyOf(it: GroupKeySource): string {
  return normOpt(it.china_option2) || EMPTY_OPT;
}

/** 세트 인스턴스 키 — 세트면 product_id, 아니면 null (product_id 없는 세트는 단품 취급) */
export function setInstanceKeyOf(it: Pick<FtOrderItem, 'set_total' | 'product_id'>): string | null {
  return (it.set_total ?? 0) > 1 && it.product_id ? it.product_id : null;
}

/**
 * 잔여 = order_qty − ARRIVAL − CANCEL  (V2 입고 입력 한도와 같은 공식)
 *   RETURN 은 입고 후 사건이라 한도에 영향 없음
 */
export function remainingOf(
  row: Pick<FtOrderItem, 'id' | 'order_qty'>,
  arrivalMap: Map<string, number>,
  cancelMap: Map<string, number>
): number {
  return Math.max(0, (row.order_qty ?? 0) - (arrivalMap.get(row.id) ?? 0) - (cancelMap.get(row.id) ?? 0));
}

/** 숫자 인식 사전순 비교 — 120 < 130 < 1000, item_no 정렬에도 사용 */
export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
