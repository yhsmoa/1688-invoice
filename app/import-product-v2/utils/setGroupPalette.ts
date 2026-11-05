// ============================================================
// 세트 그룹 — 단일 판정 함수
//
// "세트 그룹" 정의 (단일 기준):
//   set_total > 1  AND  (order_no, product_id) 동일
//
// 이 키를 기준으로 인접 행 간 가로 border 제거 · 체크박스 옆 묶음선 위치를 정한다.
// 묶음선·세트 배지 색은 한 가지(주황, ItemCheck.css 의 --set-accent 기본값)이며
// 예전의 그룹별 5색 순환 팔레트는 제거했다 (사용자 요청: 색 통일).
// ============================================================

// ── 세트 그룹 키 추출 ────────────────────────────────────
// 반환값:
//   - 세트 상품이면서 (order_no, product_id) 양쪽 존재 → "order_no|product_id"
//   - 그 외 (set_total <= 1 이거나 키 구성 불가) → null
export interface SetGroupKeySource {
  set_total: number | null;
  order_no: string | null;
  product_id: string | null;
}

export function getSetGroupKey(item: SetGroupKeySource): string | null {
  if (item.set_total == null || item.set_total <= 1) return null;
  if (!item.product_id) return null;
  return `${item.order_no ?? ''}|${item.product_id}`;
}
