// ============================================================
// 세트 그룹 — 단일 판정 + 컬러 팔레트
//
// "세트 그룹" 정의 (단일 기준):
//   set_total > 1  AND  (order_no, product_id) 동일
//
// 이 키를 기준으로:
//   1. 팔레트 색상 인덱스 부여 (양쪽 사이드 border + 배지 톤 통일)
//   2. 인접 행 간 가로 border 제거 여부 판정
//
// 두 시각 효과가 동일한 판정 함수(getSetGroupKey)를 공유하여
// "세트로 보이는데 그룹핑은 안 되는" 엇갈림이 발생하지 않도록 설계.
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

export interface SetGroupColor {
  /** 행 양쪽 바깥 border 색상 */
  border: string;
  /** 배지 배경 색상 */
  bg: string;
  /** 배지 텍스트 색상 */
  text: string;
}

// ── 팔레트 (5색 사이클) ─────────────────────────────────
export const SET_GROUP_PALETTE: readonly SetGroupColor[] = [
  { border: '#e65100', bg: '#fff3e0', text: '#e65100' }, // 0: 주황 (기본)
  { border: '#1565c0', bg: '#e3f2fd', text: '#1565c0' }, // 1: 파랑
  { border: '#2e7d32', bg: '#e8f5e9', text: '#2e7d32' }, // 2: 녹색
  { border: '#6a1b9a', bg: '#f3e5f5', text: '#6a1b9a' }, // 3: 보라
  { border: '#c2185b', bg: '#fce4ec', text: '#c2185b' }, // 4: 진핑크
];

// ── 인덱스 → 색상 (팔레트 길이 기준 순환) ─────────────────
export function resolveSetGroupColor(idx: number): SetGroupColor {
  return SET_GROUP_PALETTE[idx % SET_GROUP_PALETTE.length];
}
