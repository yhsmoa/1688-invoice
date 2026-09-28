// ============================================================
// 1688 배송상황 — 같은 주문의 여러 행 중 대표 1행 고르기
//
// 읽기 API(/api/ft/1688-delivery-status)와 업로드 API
// (/api/upload-delivery-status-csv 의 배송 이력 반영)가 같은 기준을 써야
// 화면에 보이는 상태와 이력에 기록되는 상태가 어긋나지 않는다.
//
// ── 왜 timestamp 로 고르지 않는가 ─────────────────────────
// CSV 는 1688 주문목록을 탭별로 덤프한 것이라 한 주문이 여러 탭에 중복 등장한다.
//   待发货 탭 행  : delivery_status 가 待发货/待收货 뿐, 상세 없음 (플레이스홀더)
//   待收货 탭 행  : 已签收/运输中/派送中/已发货 등 실제 물류 상태 + 상세
//   退款售后 탭 행: 환불 진행 상태
// 그런데 같은 주문의 행들은 timestamp 가 모두 동일(주문일시)해서 정렬로 구분이
// 불가능하다 → 동점이면 순서가 비결정적이라 플레이스홀더 행이 뽑힐 수 있었다.
// (실측: 중복 주문 553건 전부 timestamp 동일, 그중 282건이 오표시 가능)
//
// → order_status(탭) 우선순위로 실제 물류 상태 행을 고른다.
//   동일 탭이면 상세 있는 행 → timestamp 최신 순.
// ============================================================

/** 탭 우선순위 — 클수록 실제 배송 상태에 가까움 */
const TAB_PRIORITY: Record<string, number> = {
  '待收货':   3,  // 수령 대기 — 실제 물류 상태(운송중/배송완료 등)
  '退款售后': 2,  // 환불/사후 — 배송은 끝났고 환불 진행
  '待发货':   1,  // 발송 대기 — 플레이스홀더
};

/** 대표 행 판정에 필요한 최소 필드 */
export interface DeliveryRowLike {
  order_status: string | null;
  description: string | null;
  timestamp: string | null;
}

/** 같은 주문의 두 행 중 어느 쪽을 대표로 할지 — 크면 우선 */
export function deliveryRowScore(row: DeliveryRowLike): number {
  const tab = TAB_PRIORITY[row.order_status ?? ''] ?? 0;
  const hasDesc = row.description && row.description.trim() !== '' ? 1 : 0;
  const ts = row.timestamp ? Date.parse(row.timestamp) : 0;
  // 탭 > 상세유무 > 최신 순 (자릿수 분리로 안정적 비교)
  return tab * 1e15 + hasDesc * 1e14 + (isNaN(ts) ? 0 : ts);
}

/**
 * 주문번호별 대표 1행만 남긴다.
 * 점수가 같으면 먼저 나온 행 유지 (입력 순서 기준 결정적).
 */
export function pickRepresentativeRows<T extends DeliveryRowLike>(
  rows: T[],
  keyOf: (row: T) => string | null | undefined
): Map<string, T> {
  const best = new Map<string, { row: T; score: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const score = deliveryRowScore(row);
    const cur = best.get(key);
    if (!cur || score > cur.score) best.set(key, { row, score });
  }
  const out = new Map<string, T>();
  for (const [k, v] of best) out.set(k, v.row);
  return out;
}
