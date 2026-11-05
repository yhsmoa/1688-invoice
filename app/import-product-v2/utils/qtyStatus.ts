// ============================================================
// 수량 칸(진행·입고·포장·취소·출고) 색 판정 — 상품입고 V2 테이블
//
// 한 행의 상태를 "지금 어느 단계가 남았나" 로 읽는다.
//   주황(pending) = 아직 남은 단계      초록(done) = 그 단계는 끝남
//   회색(idle)    = 할 일이 없는 칸      빨강(cancel) = 취소·반품 (정보, 항상)
//   none          = 0 (빈 칸 표시)
//
// 기준 수량
//   remainingArrival = order - arrival - cancel   아직 들어올 수량 (RETURN 은 입고 뒤 반품이라 무관)
//   arrivalDone      = remainingArrival <= 0      더 들어올 게 없음 (취소분 포함해 정리됨)
//   inHand           = arrival - return           손에 있어서 포장·출고해야 할 수량
//   progress         = order - cancel - return - shipped   테이블 '진행' 공식 그대로
//   allDone          = progress <= 0              이 행은 더 할 일이 없음
//
// 칸별 규칙 (위에서 아래로 첫 번째로 맞는 것)
//   진행  0 이하 → none · arrivalDone(더 들어올 게 없음) → none(빈 칸) · 그 외(더 들어올 게 있음) → pending
//   입고  0 → none · arrivalDone(더 들어올 게 없음) → idle · 그 외(더 들어올 게 있음) → done
//   포장  0 → none · allDone → idle · packed ≥ inHand → done · 그 외 → pending
//   취소  0 → none · 그 외 → cancel (allDone 이어도 빨강 — 이력 정보)
//   출고  0 → none · allDone → idle · shipped ≥ inHand → done · 그 외(출고 남음) → pending
//
// 모순이 없도록 한 점
//   · allDone 이면 진행은 0 이라 none, 나머지 네 칸은 idle 또는 none (취소만 빨강) → "전부 회색"
//   · arrivalDone 이 아니면 진행 pending(주황), 입고 done(초록) — "들어오는 중" 을 두 칸이 같이 표시
//   · arrivalDone 이면 진행은 빈 칸, 입고 idle — 수량대로 다 들어왔거나 취소분까지 합쳐 더 들어올
//     예정이 없으면 "진행" 숫자는 사라진다 (아직 들어올 게 있을 때만 숫자가 남는다)
//   · arrivalDone 이고 allDone 이 아니면 남은 단계(포장·출고)만 pending
//   · 초과 입고(arrival > order - cancel), 입고 없이 포장(packed > arrival) 도 비교식이라 예외 없이 판정된다
//
// ⚠️ packed / shipment(표시값) 는 product_id 기준 합계라 세트상품은 품목 합이 섞인다 —
//    색 판정의 출고 비교는 item 기준(shippedItemQty) 으로 하고, 표시값만 product 기준을 쓴다.
// ============================================================

export type QtyTone = 'pending' | 'done' | 'idle' | 'cancel' | 'none';

export interface QtyCell {
  value: number;
  tone: QtyTone;
}

export interface QtyStatusInput {
  /** ft_order_items.order_qty */
  orderQty: number;
  /** ARRIVAL 합 (item 기준) */
  arrivalQty: number;
  /** PACKED 합 (product 기준 — 표시·판정 공용) */
  packedQty: number;
  /** CANCEL 합 (raw) */
  cancelQty: number;
  /** RETURN 합 (raw) */
  returnQty: number;
  /** PACKED + shipment_id (item 기준) — 진행 공식·출고 판정용 */
  shippedItemQty: number;
  /** PACKED + shipment_id (product 기준) — 출고 칸 표시값 */
  shipmentDisplayQty: number;
}

export interface QtyStatus {
  progress: QtyCell;
  arrival: QtyCell;
  packed: QtyCell;
  cancel: QtyCell;
  ship: QtyCell;
}

export function resolveQtyStatus(q: QtyStatusInput): QtyStatus {
  const remainingArrival = q.orderQty - q.arrivalQty - q.cancelQty;
  const arrivalDone = remainingArrival <= 0;
  const inHand = q.arrivalQty - q.returnQty;
  const progress = q.orderQty - q.cancelQty - q.returnQty - q.shippedItemQty;
  const allDone = progress <= 0;
  const cancelTotal = q.cancelQty + q.returnQty;

  return {
    progress: {
      value: progress,
      tone: progress <= 0 || arrivalDone ? 'none' : 'pending',
    },
    arrival: {
      value: q.arrivalQty,
      tone: q.arrivalQty <= 0 ? 'none' : arrivalDone ? 'idle' : 'done',
    },
    packed: {
      value: q.packedQty,
      tone: q.packedQty <= 0 ? 'none' : allDone ? 'idle' : q.packedQty >= inHand ? 'done' : 'pending',
    },
    cancel: {
      value: cancelTotal,
      tone: cancelTotal <= 0 ? 'none' : 'cancel',
    },
    ship: {
      value: q.shipmentDisplayQty,
      tone:
        q.shipmentDisplayQty <= 0 ? 'none' : allDone ? 'idle' : q.shippedItemQty >= inHand ? 'done' : 'pending',
    },
  };
}
