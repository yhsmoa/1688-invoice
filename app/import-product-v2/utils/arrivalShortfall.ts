import type { FtOrderItem } from '../hooks/useFtData';

// ============================================================
// 주문행 1개의 입고 부족 계산 — 상품입고 V2/V3
//
//   expected (입고되어야 할 수량) = max(0, order_qty − CANCEL)
//   arrived  (입고 수량)          = ARRIVAL + 지금 작업 열에 넣은 수량
//   short    (부족)               = expected − arrived   (초과 입고면 음수 그대로)
//
//   쓰는 곳:
//     ItemCheck missingRows          → short > 0 인 행만 [미입고] 접수 대상
//     ItemCheck sellerCheckRows      → 선택한 행 전부 [1688 판매자 확인] — expected 는 확인수량 입력의 처음 값,
//                                      arrived 는 그대로 보낸다 (short 는 보내지 않고 0)
// ============================================================

export interface ArrivalShortfall {
  /** 입고되어야 할 수량 = order_qty − CANCEL (0 이상) */
  expected: number;
  /** 입고 수량 = ARRIVAL + 작업 입력 */
  arrived: number;
  /** 부족 = expected − arrived (초과 입고면 음수) */
  short: number;
}

/** 주문행 + 계산된 수량 — [미입고] · [1688 판매자 확인] 모달 공용 */
export interface ShortfallRow extends ArrivalShortfall {
  item: FtOrderItem;
}

export function computeArrivalShortfall(
  item: FtOrderItem,
  arrivalMap: ReadonlyMap<string, number>,
  cancelMap: ReadonlyMap<string, number>,
  workQtyMap: ReadonlyMap<string, number>,
): ArrivalShortfall {
  const expected = Math.max(0, (item.order_qty ?? 0) - (cancelMap.get(item.id) ?? 0));
  const arrived = (arrivalMap.get(item.id) ?? 0) + (workQtyMap.get(item.id) ?? 0);
  return { expected, arrived, short: expected - arrived };
}
