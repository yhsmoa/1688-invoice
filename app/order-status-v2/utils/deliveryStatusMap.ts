// ============================================================
// 배송 상태 매핑 (im_1688_orders_delivery_status 표시용)
//
// · order_status (주문 상태)   → 이모지
// · delivery_status (배송 상태) → 한글
// · 매핑 miss 시 원본 값 그대로 반환 (디버깅 용이)
// ============================================================

// ── 주문 상태 이모지 ─────────────────────────────────────
export const ORDER_STATUS_EMOJI: Record<string, string> = {
  '待发货': '📝',   // 발송 대기
  '待收货': '📦',   // 수령 대기
};

// ── 배송 상태 한글 ───────────────────────────────────────
export const DELIVERY_STATUS_KR: Record<string, string> = {
  '部分已发货': '일부배송',
  '待发货':     '배송전',
  '发货超时':   '처리지연',
  '已发货':     '송장등록',
  '已签收':     '배송완료',
  '待收货':     '운송중(서명대기)',
  '运输中':     '운송중',
  '派送中':     '운송중',
};

// ── 배송 상태 정보 타입 (API 응답과 동일 형식) ──────────
export interface DeliveryStatusInfo {
  order_status: string;
  delivery_status: string;
  description: string;
  timestamp: string;
}

// ============================================================
// 표시 포맷 생성
//
// 규칙:
//   "{이모지} {한글}"
//   order_status === '待发货' 이고 description 이 있으면 뒤에 description 추가
// ============================================================
export function formatDeliveryDisplay(info: DeliveryStatusInfo): string {
  const os = ORDER_STATUS_EMOJI[info.order_status] ?? info.order_status;
  const ds = DELIVERY_STATUS_KR[info.delivery_status] ?? info.delivery_status;

  const parts = [os, ds].filter(Boolean);
  let result = parts.join(' ').trim();

  if (info.order_status === '待发货' && info.description) {
    result = `${result} ${info.description}`.trim();
  }

  return result;
}
