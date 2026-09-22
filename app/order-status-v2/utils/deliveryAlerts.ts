import type { DeliveryStatusInfo } from './deliveryStatusMap';
import { DELIVERY_STATUS_KR } from './deliveryStatusMap';
import { deliveryPhase } from '../../../lib/deliveryPhase';

// ============================================================
// 배송 경고 판정 — "판매자/담당자 확인이 필요한 항목" 찾기
//
// 항목(ft_order_items 행) 단위로 판정한다. 1688 주문 하나에 여러 항목이
// 있으면 각 행에 같은 경고가 붙는다.
//
// 기준 (일수는 ALERT_RULES 에서만 조정):
//   배송전       주문 후 PENDING_DAYS 초과            근거: 주문일시(CSV)
//   집하대기     이 상태로 PICKUP_DAYS 초과            근거: status_since
//   운송중       배송위치 문구가 그대로인 채 TRANSIT_STALL_DAYS 초과
//                                                     근거: location_since
//   이상 상태    항상 (처리지연·집하지연·물류이상·물류정체)
//   배송완료     완료 후 ARRIVAL_DAYS 지나도 입고 수량이 목표(주문−취소−반품)에
//                못 미침                              근거: status_since + 입고 집계
//
// 공통 제외: 항목 DONE / 입고가 목표 수량을 채움 / 배송 정보 없음
//
// status_since·location_since 는 CSV 업로드 때 이전 업로드와 비교해
// 이어받는 값이라, 정확도는 업로드 빈도(매일 1회 전제)에 달려 있다.
// ============================================================

// ── 기준 일수 ──
export const ALERT_RULES = {
  /** 배송전: 주문 후 며칠까지 정상 */
  PENDING_DAYS: 3,
  /** 집하대기: 이 상태로 며칠까지 정상 */
  PICKUP_DAYS: 3,
  /** 운송중: 배송위치가 안 바뀐 채 며칠까지 정상 */
  TRANSIT_STALL_DAYS: 3,
  /** 배송완료 후 며칠 안에 입고가 끝나야 정상 */
  ARRIVAL_DAYS: 3,
} as const;

// ── 상태 분류는 lib/deliveryPhase (업로드 API 의 status_since 이어받기와 동일 기준) ──

export type DeliveryAlertKind = 'abnormal' | 'pending' | 'pickup' | 'stalled' | 'arrival';

export interface DeliveryAlert {
  kind: DeliveryAlertKind;
  /** 경과 일수 (정렬·표시용, 내림) */
  days: number;
  /** 툴팁 문구 — 왜 경고인지 */
  message: string;
}

export interface DeliveryAlertInput {
  info: DeliveryStatusInfo | undefined;
  itemStatus: string | null;
  orderQty: number | null;
  arrivalQty: number;
  cancelQty: number;
  returnQty: number;
  /** 현재 시각 — 목록을 돌 때 한 번만 만들어 넘긴다 (없으면 호출 시점) */
  now?: Date;
}

const DAY_MS = 86_400_000;

/** since 부터 지금까지 며칠 (소수) — 없거나 잘못된 값이면 null */
function elapsedDays(since: string | undefined, now: Date): number | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (isNaN(t)) return null;
  return (now.getTime() - t) / DAY_MS;
}

/** 'N일째' 표기 — 3.5일 경과면 4일째 (올림). 'N일 경과' 는 내림 */
const nth = (d: number) => Math.ceil(d);

const label = (status: string) => DELIVERY_STATUS_KR[status] ?? status;

// ============================================================
// 판정
// ============================================================
export function evaluateDeliveryAlert(input: DeliveryAlertInput): DeliveryAlert | null {
  const { info, itemStatus, orderQty, arrivalQty, cancelQty, returnQty } = input;
  const now = input.now ?? new Date();

  // ── 공통 제외 ──
  if (!info || !info.delivery_status) return null;
  if (itemStatus === 'DONE') return null;
  const target = (orderQty ?? 0) - cancelQty - returnQty;
  if (target <= 0) return null;
  if (arrivalQty >= target) return null;

  const status = info.delivery_status;
  const phase = deliveryPhase(status);

  // ── 이상 상태: 항상 ──
  if (phase === 'abnormal') {
    const d = elapsedDays(info.status_since, now) ?? 0;
    return { kind: 'abnormal', days: Math.floor(d), message: `${label(status)} — 판매자 확인 필요` };
  }

  // ── 배송전: 주문일 기준 (주문일시를 못 읽은 행은 처음 본 날로 대신) ──
  if (phase === 'pending') {
    const d = elapsedDays(info.timestamp, now) ?? elapsedDays(info.status_since, now);
    if (d !== null && d > ALERT_RULES.PENDING_DAYS) {
      return {
        kind: 'pending',
        days: Math.floor(d),
        message: `배송전 ${nth(d)}일째 (기준 ${ALERT_RULES.PENDING_DAYS}일) — 판매자 미출고`,
      };
    }
    return null;
  }

  // ── 집하대기: 상태 시작일 기준 ──
  if (phase === 'pickup') {
    const d = elapsedDays(info.status_since, now);
    if (d !== null && d > ALERT_RULES.PICKUP_DAYS) {
      return {
        kind: 'pickup',
        days: Math.floor(d),
        message: `집하대기 ${nth(d)}일째 (기준 ${ALERT_RULES.PICKUP_DAYS}일) — 택배사 미수거`,
      };
    }
    return null;
  }

  // ── 운송중: 위치 문구 시작일 기준 ──
  if (phase === 'transit') {
    const d = elapsedDays(info.location_since, now);
    if (d !== null && d > ALERT_RULES.TRANSIT_STALL_DAYS) {
      return {
        kind: 'stalled',
        days: Math.floor(d),
        message: `${label(status)} — 배송위치 변동 없이 ${nth(d)}일째 (기준 ${ALERT_RULES.TRANSIT_STALL_DAYS}일)`,
      };
    }
    return null;
  }

  // ── 배송완료: 입고가 목표 수량을 채워야 함 ──
  if (phase === 'delivered') {
    const d = elapsedDays(info.status_since, now);
    if (d !== null && d > ALERT_RULES.ARRIVAL_DAYS) {
      return {
        kind: 'arrival',
        days: Math.floor(d),
        message: `배송완료 ${Math.floor(d)}일 경과, 입고 ${arrivalQty}/${target} (기준 ${ALERT_RULES.ARRIVAL_DAYS}일)`,
      };
    }
    return null;
  }

  return null;
}
