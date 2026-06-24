# 입고 → 출고 전체 흐름 논리 검증 시나리오

## 공식 요약 (현 코드 실측)

| 항목 | 공식 | 출처 |
|---|---|---|
| **진행** (테이블 표시) | `order_qty − CANCEL − RETURN − shippedItemQty` | ItemTableRow.tsx:86-87 |
| **출고가능** (출고V2) | `ARRIVAL − ALL_PACKED − RETURN` (shipment_id 무관 ALL_PACKED) | ExportProduct.tsx:214 |
| **출고가능** (쉽먼트V2 API) | `ARRIVAL − PACKED(shipment_id≠NULL) − RETURN` | shipment-v2/route.ts:191-193 |
| **입고한도** (작업 셀 입력 검증) | `order_qty − ARRIVAL − CANCEL` | ItemCheck.tsx:461 |
| **CANCEL 입력 한도** (V2CancelModal) | `order_qty − ARRIVAL` ← ⚠️ 기존 CANCEL 미차감 | V2CancelModal.tsx:116 |
| **RETURN 입력 한도** (V2CancelModal) | `ARRIVAL − 기존RETURN` | V2CancelModal.tsx:119-120 |
| **남은수량** (PROCESSING→DONE 전환 조건) | `order_qty − CANCEL_done − RETURN_done − PACKED(shipment_id≠NULL)` | confirmDone.ts:127 |
| **취소 컬럼 표시** | `CANCEL + RETURN` | ItemTableRow.tsx:90 |

> **용어 정의**
> - `CANCEL` = ft_fulfillment_inbounds type='CANCEL' 합계 (미입고 주문취소)
> - `RETURN` = ft_fulfillment_inbounds type='RETURN' 합계 (입고 후 반품)
> - `shippedItemQty` = ft_fulfillment_outbounds PACKED where shipment_id IS NOT NULL (출고 확정 완료분)
> - `ALL_PACKED` = ft_fulfillment_outbounds PACKED 전체 (shipment_id 무관)
> - `CANCEL_done` / `RETURN_done` = ft_cancel_details where status='DONE', cancel_type별 qty 합계
> - `ALL_PACKED_shipment` = ft_fulfillment_outbounds PACKED where shipment_id IS NOT NULL

---

## 시나리오 A — 정상 완전 흐름 (아무 이슈 없음)

```
주문: order_qty = 10
입고: ARRIVAL = 10
포장: ALL_PACKED = 10 (shipment_id 있음)
취소/반품: 없음
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 진행 | 10 − 0 − 0 − 10 | **0** | ✅ 완료 |
| 출고가능 | 10 − 10 − 0 | **0** | ✅ 더 출고 없음 |
| 입고한도 | 10 − 10 − 0 | **0** | ✅ 더 입고 없음 |
| DONE 전환 | 10 − 0 − 0 − 10 = 0 | **DONE** | ✅ |

---

## 시나리오 B — 분할 입고, 진행 중

```
주문: order_qty = 10
입고: ARRIVAL = 7      (3건 아직 미입고)
포장: ALL_PACKED = 5   (shipment_id 있음)
취소/반품: 없음
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 진행 | 10 − 0 − 0 − 5 | **5** | ✅ 5건 처리 미완 |
| 출고가능 | 7 − 5 − 0 | **2** | ✅ 포장 가능 2건 남음 |
| 입고한도 | 10 − 7 − 0 | **3** | ✅ 3건 더 입고 가능 |
| DONE 전환 | 10 − 0 − 0 − 5 = 5 > 0 | **PROCESSING 유지** | ✅ |

---

## 시나리오 C — BO-260417-0057 원본 버그 케이스 (핵심)

> **버그 재현**: 주문 10 / 입고 7 / 주문취소 3 → 출고가능이 4로 표시되던 문제

```
주문: order_qty = 10
입고: ARRIVAL = 7
CANCEL: 3  (주문취소 — 미입고 3건)
RETURN: 0
ALL_PACKED: 0
```

| 항목 | 수정 전 공식 | 수정 전 결과 | 수정 후 공식 | 수정 후 결과 | 기대값 |
|---|---|---|---|---|---|
| 출고가능 | `ARRIVAL − PACKED − CANCEL` | 7−0−3 = **4** ❌ | `ARRIVAL − PACKED − RETURN` | 7−0−0 = **7** ✅ | 7 |
| 진행 | `order_qty − ARRIVAL − CANCEL` | 10−7−3 = **0** ✅ | `order_qty − CANCEL − RETURN − shippedItemQty` | 10−3−0−0 = **7** | 7 (입고 아직 7건 남음) |
| 입고한도 | (동일) | 10−7−3 = **0** | (동일) | 10−7−3 = **0** | ✅ 더 입고 불가 |

> **해석**: CANCEL 3건은 "입고 전 사건"이므로 출고가능 수량에서 차감하면 안 됨.
> 이미 입고된 7건은 전부 출고할 수 있어야 함.

---

## 시나리오 D — CANCEL 후 나머지 입고 완료

```
주문: order_qty = 10
CANCEL: 3  (먼저 주문취소)
입고: ARRIVAL = 7  (취소 3 제외 나머지)
포장 및 출고: ALL_PACKED = 7 (shipment_id 있음)
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 진행 | 10 − 3 − 0 − 7 | **0** | ✅ |
| 출고가능 | 7 − 7 − 0 | **0** | ✅ |
| 입고한도 | 10 − 7 − 3 | **0** | ✅ |
| DONE 전환 조건 | 10 − 3(done) − 0 − 7 = 0 | **DONE** | ✅ |

> ⚠️ DONE 전환은 CANCEL_done (ft_cancel_details.status='DONE')만 사용.
> CANCEL 접수만 된 상태(status=PENDING/PROCESSING)이면 남은수량 > 0이어서 DONE 미전환됨. 이것이 의도된 동작.

---

## 시나리오 E — RETURN (반품접수) 시나리오

```
주문: order_qty = 10
입고: ARRIVAL = 10
출고: ALL_PACKED = 6 (shipment_id 있음)
RETURN: 3  (출고하지 않은 재고에서 반품)
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 진행 | 10 − 0 − 3 − 6 | **1** | ✅ 1건 미처리 |
| 출고가능 | 10 − 6 − 3 | **1** | ✅ 1건 더 출고 가능 |
| 입고한도 | 10 − 10 − 0 | **0** | ✅ 더 입고 불가 |

> RETURN 수량 한도 검증 (V2CancelModal): `RETURN ≤ ARRIVAL − 기존RETURN`
> = `10 − 0 = 10`이므로 최대 10건까지 반품 가능. 3건은 유효.

---

## 시나리오 F — CANCEL + RETURN 혼합

```
주문: order_qty = 10
CANCEL: 2  (주문취소, 미입고분)
입고: ARRIVAL = 8
RETURN: 3  (입고 후 반품)
출고: ALL_PACKED = 5 (shipment_id 있음)
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 진행 | 10 − 2 − 3 − 5 | **0** | ✅ 처리 완료 |
| 출고가능 | 8 − 5 − 3 | **0** | ✅ |
| 입고한도 | 10 − 8 − 2 | **0** | ✅ |
| 취소 컬럼 표시 | 2 + 3 | **5** | 단일 컬럼에 5 표시 |

---

## 시나리오 G — RETURN이 출고 중인 수량까지 포함되는 경우

```
주문: order_qty = 10
입고: ARRIVAL = 10
포장(미확정): ALL_PACKED = 4, shipment_id = NULL
포장(확정): 0
RETURN: 7
```

| 항목 | 계산 | 결과 | 기대값 |
|---|---|---|---|
| 출고가능 | 10 − 4 − 7 | **−1** ❌ | 음수 → 필터링됨 |

> ⚠️ **주의**: V2CancelModal RETURN 입력 한도는 `ARRIVAL − 기존RETURN`만 검증.
> 포장 중인 물량(ALL_PACKED)을 고려하지 않으므로, 이론상 `RETURN > ARRIVAL − ALL_PACKED` 인 상태가 만들어질 수 있음.
> ExportProduct는 available ≤ 0인 아이템을 목록에서 제외하므로 출고 UI에서는 보이지 않게 됨. 기능 장애는 없지만 데이터 무결성 경고.

---

## 시나리오 H — RETURN 한도 초과 시도 (UI 차단 확인)

```
주문: order_qty = 10
입고: ARRIVAL = 10
기존 RETURN: 6
신규 RETURN 시도: 5
```

V2CancelModal 검증:
- 한도 = `ARRIVAL − 기존RETURN = 10 − 6 = 4`
- 입력 5 > 한도 4 → **입력 불가 (붉은 테두리 + 제출 차단)** ✅

---

## 시나리오 I — CANCEL 한도 (실제 코드 검증)

```
주문: order_qty = 10
입고: ARRIVAL = 7
기존 CANCEL: 1  (이미 ft_fulfillment_inbounds에 저장됨)
신규 CANCEL 시도: 3
```

**실제 코드 (V2CancelModal.tsx:115-116):**
```ts
if (cancelType === 'CANCEL') {
  return Math.max(0, (item.order_qty ?? 0) - arrival);
}
```

| 항목 | 기대값 | 실제 동작 |
|---|---|---|
| 한도 계산 | `10 − 7 − 1 = 2` (기존 CANCEL 차감) | `10 − 7 = 3` (기존 CANCEL **미차감**) ❌ |
| 입력 3 허용 여부 | 3 > 2 → 차단 기대 | 3 ≤ 3 → **통과** ❌ |
| 최종 CANCEL 합계 | — | `1 + 3 = 4 > 3(미입고분)` → **과취소** ❌ |

> **⚠️ 버그**: cancelMap이 V2CancelModal에 전달되지 않아 기존 CANCEL 수량이 한도 계산에서 누락됨.
> 실무 영향: 미입고 수량(3건)보다 더 많은 취소를 접수할 수 있음.
> RETURN은 `existingReturn`을 차감하는데 CANCEL만 누락된 비대칭 설계.

**수정 필요 범위:**
- V2CancelModal props에 `cancelMap?: Map<string, number>` 추가
- `computeInputLimit` 내 CANCEL 분기: `order_qty − arrival − existingCancel`
- 호출부(ItemCheck.tsx, OrderStatusV2.tsx)에서 `cancelMap` 전달

---

## 시나리오 J — DONE 전환 타이밍 (CANCEL 접수 → 완료 처리)

```
주문: order_qty = 5
CANCEL 접수(PENDING): qty = 5  ← ft_cancel_details.status = PENDING
출고완료: ALL_PACKED = 0
```

| 시점 | CANCEL_done | 남은수량 | DONE 여부 |
|---|---|---|---|
| 접수 직후 | 0 | 5 − 0 − 0 − 0 = 5 | ❌ PROCESSING 유지 |
| 반품접수 V2에서 DONE 처리 | 5 | 5 − 5 − 0 − 0 = 0 | ✅ DONE 전환 |

> 설계 의도: 취소 "접수"만으로 DONE 전환하지 않고, 반품접수 V2에서 담당자가 완료 확인 후 DONE 처리해야 주문이 종결됨.

---

## 시나리오 K — 포장 단계별 진행 표시 차이 + 출고V2/쉽먼트API 공식 차이

```
주문: order_qty = 10
입고: ARRIVAL = 10
포장(shipment_id = NULL): PACKED = 8  ← 출고 V2에서 박스에 담는 중
포장(shipment_id ≠ NULL): 0           ← 쉽먼트 V2 미확정
```

| 항목 | 공식 | 계산 | 결과 | 출처 |
|---|---|---|---|---|
| 진행 (입고V2 테이블) | `order_qty − CANCEL − RETURN − shippedItemQty` | 10−0−0−**0** | **10** | shippedItemQty = 0 (shipment_id없는 PACKED 미포함) |
| 출고가능 (출고V2) | `ARRIVAL − ALL_PACKED − RETURN` | 10−**8**−0 | **2** | ALL_PACKED 사용 → 포장 중 8건 제외 |
| 출고가능 (쉽먼트API) | `ARRIVAL − PACKED(shipment_id≠NULL) − RETURN` | 10−**0**−0 | **10** | shipment_id=NULL 은 미차감 |

> **공식 차이 의도:**
> - 출고V2: "지금 더 포장할 수 있는가" → 이미 박스에 담긴 것(shipment_id 무관)도 제외해야 이중 포장 방지
> - 쉽먼트API: "이 배송에 얼마나 넣을 수 있는가" → 이미 확정 출고된 것만 제외, 현재 포장 중인 것은 이 배송에 포함 예정
>
> **진행 컬럼**: shipment_id=NULL인 PACKED는 "포장 중이지만 미확정" → 진행에서 차감 안 함. 쉽먼트 V2에서 [출고] 눌러 shipment_id가 생기는 시점에 비로소 진행=0

---

## 논리 검증 결론 (코드 실측 기반)

| 시나리오 | 결과 | 비고 |
|---|---|---|
| A 정상 완전 흐름 | ✅ | — |
| B 분할 입고 진행 중 | ✅ | — |
| C BO-260417-0057 버그 수정 확인 | ✅ | 수정 후 정상 |
| D CANCEL 후 나머지 출고 | ✅ | — |
| E RETURN 시나리오 | ✅ | — |
| F CANCEL + RETURN 혼합 | ✅ | — |
| G RETURN > 미출고 재고 (음수 경계) | ⚠️ | 기능 장애 없음, 무결성 경고 |
| H RETURN 한도 초과 UI 차단 | ✅ | 기존RETURN 정상 차감 |
| I CANCEL 한도 (기존 CANCEL 미차감) | ❌ **버그** | cancelMap 미전달 → 과취소 가능 |
| J DONE 전환 타이밍 | ✅ | 설계 의도대로 |
| K 출고V2/쉽먼트API 공식 차이 | ✅ | 단계별 의도된 차이 |

---

## 발견된 버그 및 권고 조치

### [버그] 시나리오 I — CANCEL 한도 미검증
**파일**: `app/import-product-v2/components/V2CancelModal.tsx:115-116`

현재:
```ts
if (cancelType === 'CANCEL') {
  return Math.max(0, (item.order_qty ?? 0) - arrival);
}
```

수정 필요:
```ts
if (cancelType === 'CANCEL') {
  const existingCancel = cancelMap?.get(item.id) ?? 0;
  return Math.max(0, (item.order_qty ?? 0) - arrival - existingCancel);
}
```

호출부에서 `cancelMap` 추가 전달 필요:
- `app/import-product-v2/ItemCheck.tsx`
- `app/order-status-v2/OrderStatusV2.tsx`

---

### [경고] 시나리오 G — RETURN이 포장 중 재고 초과 가능
**상황**: `ALL_PACKED > 0 (shipment_id=NULL)` 상태에서 RETURN 접수 시 `출고가능 < 0` 가능.

현재 RETURN 한도: `ARRIVAL − 기존RETURN` (포장 중 재고 미고려)
강화 옵션: `ARRIVAL − 기존RETURN − ALL_PACKED`

→ 실제 발생 여부 확인 후 결정 권고. ExportProduct의 `available > 0` 필터가 화면상 오류를 막아주고 있음.
