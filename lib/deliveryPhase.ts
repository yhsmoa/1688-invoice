// ============================================================
// 1688 배송 상태 → 단계(phase) 분류
//
// 업로드 API(status_since 이어받기)와 화면 판정(deliveryAlerts)이 같은
// 기준을 써야 하므로 공용으로 둔다.
//
// 같은 단계 안에서 상태 글자만 바뀌는 전환은 "새 상태"가 아니다:
//   已签收(배송완료) → 已收货未到账(수령완료)   : 둘 다 delivered
//   揽收已超时 → 揽收严重超时                   : 둘 다 abnormal
// 이런 전환에서 status_since 를 리셋하면 경고 시계가 다시 시작돼 버린다.
// ============================================================

export type DeliveryPhase = 'abnormal' | 'pending' | 'pickup' | 'transit' | 'delivered';

const PHASE_OF: Record<string, DeliveryPhase> = {
  // 이상 — 기간과 상관없이 확인 필요
  '发货超时': 'abnormal',
  '揽收已超时': 'abnormal',
  '揽收严重超时': 'abnormal',
  '物流异常': 'abnormal',
  '物流异常提醒': 'abnormal',
  '物流停滞': 'abnormal',
  // 배송전 — 판매자가 아직 출고 안 함 (일부배송도 나머지는 출고 전)
  '待发货': 'pending',
  '部分已发货': 'pending',
  // 집하대기 — 송장은 나왔고 택배사가 아직 안 가져감
  '待揽收': 'pickup',
  // 운송중 — 택배가 이동 중
  '已发货': 'transit',
  '已揽收': 'transit',
  '已揽件': 'transit',
  '运输中': 'transit',
  '派送中': 'transit',
  '待收货': 'transit',
  // 배송완료 — 물건은 도착, 이제 입고가 돼야 함
  '已签收': 'delivered',
  '已收货未到账': 'delivered',
};

/** 상태 → 단계. 모르는 상태면 null */
export function deliveryPhase(status: string | null | undefined): DeliveryPhase | null {
  if (!status) return null;
  return PHASE_OF[status] ?? null;
}

/** 두 상태가 같은 단계인지 — 글자가 같거나, 둘 다 아는 상태이고 단계가 같으면 true */
export function samePhase(a: string | null | undefined, b: string | null | undefined): boolean {
  if ((a ?? '') === (b ?? '')) return true;
  const pa = deliveryPhase(a);
  return pa !== null && pa === deliveryPhase(b);
}
