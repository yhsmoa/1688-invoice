import type { PendingRow } from '../../../storage/types';
import { normalizeProductNo } from '../../../storage/utils/storageFormat';
import type { PendingProduct } from '../types';

// ============================================================
// 배치 대기 목록 — 입고 줄을 상품으로 묶기 · 주문번호 라벨로 찾기 · 검색
//   PC [작업중] (app/storage/pending/Pending.tsx · components/PutawayModal.tsx) 과 같은 규칙
// ============================================================

/** 주문번호(product_no)의 토막 수 — BZ-260224-0202 (라벨은 뒤에 -A01 같은 토막이 더 붙는다) */
const PRODUCT_NO_PARTS = 3;
/** 주문번호 라벨 모양 — 영문·숫자 토막이 하이픈으로 3개 이상 이어진 값 */
const LABEL_RE = new RegExp(`^[A-Za-z0-9]+(-[A-Za-z0-9]+){${PRODUCT_NO_PARTS - 1},}$`);

const compact = (raw: string): string => String(raw ?? '').replace(/\s+/g, '');
const sameCode = (a: string | null | undefined, b: string): boolean =>
  !!a && a.trim().toUpperCase() === b.toUpperCase();

// ============================================================
// 묶기
// ============================================================

// ── 입고 줄 → 상품. 서버가 상품마다 오래된 줄부터 주므로 처음 만난 줄이 대표(head)다 ──
export function groupPending(rows: PendingRow[]): PendingProduct[] {
  const byProduct = new Map<string, PendingProduct>();
  for (const row of rows) {
    const found = byProduct.get(row.product_id);
    if (found) found.unplaced += row.line_unplaced;
    else byProduct.set(row.product_id, { product_id: row.product_id, user_id: row.user_id, head: row, unplaced: row.line_unplaced });
  }
  return Array.from(byProduct.values());
}

/** 미배치 수량 합 */
export const totalUnplaced = (products: PendingProduct[]): number =>
  products.reduce((sum, p) => sum + p.unplaced, 0);

/** 여러 사업자의 상품이 섞여 있는가 (섞였을 때만 줄마다 사업자를 보여 준다) */
export const hasMixedUsers = (products: PendingProduct[]): boolean =>
  new Set(products.map((p) => p.user_id)).size > 1;

// ============================================================
// 주문번호 라벨
// ============================================================

/** 스캔 · 입력 값 → 주문번호 (BZ-260224-0202-A01 → BZ-260224-0202) */
export const labelCode = (raw: string): string => normalizeProductNo(compact(raw));

/** 주문번호 라벨 모양인가 (목록에 없을 때 "없는 주문번호" 로 알릴지, 그냥 검색어로 볼지 가른다) */
export const isLabelShaped = (raw: string): boolean => LABEL_RE.test(compact(raw));

/** 그 주문번호의 상품 — 사업자가 다르면 여러 개일 수 있다 */
export function findByLabel(products: PendingProduct[], code: string): PendingProduct[] {
  return products.filter((p) => sameCode(p.head.product_no, code));
}

/** 사업자마다 하나씩 (같은 사업자에 여럿이면 PC 와 같이 첫 상품) */
export function onePerUser(products: PendingProduct[]): PendingProduct[] {
  const seen = new Set<string>();
  return products.filter((p) => (seen.has(p.user_id) ? false : (seen.add(p.user_id), true)));
}

/** 읽은 값이 그 상품 자신의 라벨인가 (주문번호 라벨 · 상품 바코드) — 위치 라벨로 받으면 안 되는 값 */
export function isOwnLabel(product: PendingProduct, raw: string): boolean {
  return sameCode(product.head.product_no, labelCode(raw)) || sameCode(product.head.barcode, compact(raw));
}

// ============================================================
// 검색 (주문번호 · 상품명 · 옵션 · 바코드) — 라벨 전체를 넣어도 주문번호로 걸리게 한다
// ============================================================
export function searchProducts(products: PendingProduct[], text: string): PendingProduct[] {
  const q = text.trim().toLowerCase();
  if (!q) return products;
  const code = labelCode(text).toLowerCase();
  return products.filter(({ head }) =>
    [head.product_no, head.item_name, head.option_name, head.china_option1, head.china_option2, head.barcode]
      .some((v) => {
        const value = v?.toLowerCase();
        return !!value && (value.includes(q) || value.includes(code));
      })
  );
}
