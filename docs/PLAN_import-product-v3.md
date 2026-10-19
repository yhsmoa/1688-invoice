# 작업 계획 — 상품입고 V3 (`/import-product-v3`) : 색상 카드 + 옵션 일괄 배분 입고

작성일: 2026-10-18 · 상태: **구현 완료 (2026-10-18, 커밋 전)** — 계획과 달라진 점·검증 범위는 맨 아래 "15. 구현 결과" 참조 · 구현·검수 담당: Opus 5.5
대상: 새 메뉴 "상품입고V3" (상품입고 ↔ 상품출고 사이) + 새 페이지 `app/import-product-v3/`
기준 페이지: `/import-product-v2` (`app/import-product-v2/ItemCheck.tsx`) — **기능은 전부 동일, UI 와 입력 방식만 개편**

> 이 문서는 "왜 이렇게 설계했는가" 까지 적어 두었다. 구현자는 **4장(그룹핑) · 6장(배분) · 8장(세트 라벨 스티커 규칙) · 10장(시나리오)** 를 먼저 읽고, 12장의 결정 사항에 사용자 답을 받은 뒤 13장 순서대로 진행한다.

---

## 0. 조사 요약 (Supabase 실측, 2026-10-18 기준, project `mkcxpkblohioqboemmah`)

### 0-1. 테이블 건수 — 전부 1000행 초과 → 모든 조회는 `range()` 페이지네이션 필수

| 테이블 | 건수 | 비고 |
|---|---|---|
| `ft_order_items` | 37,138 (PROCESSING 5,494) | 주문 항목. `user_id` 컬럼 있음 |
| `ft_fulfillment_inbounds` | 36,935 | ARRIVAL / CANCEL / RETURN |
| `label_print_logs` | 11,511 (barcode 7,623행·37,134장 / care 3,888행·33,305장) | **첫 기록 2026-09-08** — 그 이전 출력(BarTender)은 기록 없음 |
| `1688_invoice_deliveryInfo_check` | 8,148 | 배송번호 → `order_id` 매핑 |
| `invoiceManager_label` | 53 | BarTender 레거시 경로 (operator_no 별 삭제 후 삽입) — 아직 사용 중 |

### 0-2. 데이터 모양 — 설계의 근거

- **색상은 `china_option1`, 사이즈는 `china_option2`** 다. (예: `黑色` / `160cm`, `条纹卫衣棕色` / `120`, `HW36` / `140cm`). `option_name` 은 쿠팡 한글 옵션(`160 그레이+블랙`)으로 세트 구성품끼리 **동일**해서 구분 키로 못 쓴다. PROCESSING 에서 `china_option1`·`1688_offer_id`·`barcode` NULL 은 **0건**.
- **세트 구성품(set_total > 1)** 은 같은 `product_id`·`product_no`(3파트)·`barcode`·`option_name`·`order_qty`·`1688_order_id`·`1688_offer_id` 를 공유하고, `china_option1`(색상) 과 `set_seq` 만 다르다. PROCESSING 세트 1,320개 중 **구성품이 서로 다른 1688 주문/오퍼에서 오는 세트 13개(약 1%)**, 바코드가 다른 세트 0개, `composition` 이 다른 세트 3개.
- **P(PERSONAL) 건의 실체**: 같은 (오퍼, 색상, 사이즈) 가 **46행** 인 그룹이 있다 — 46개의 서로 다른 `personal_order_no`·`product_no`·`product_id`(= 46개의 세트 인스턴스), 그러나 **바코드는 1개**. 즉 "10 을 입력하면 10개 주문행에 1씩" 이 정확히 이 케이스다. 라벨 스티커는 바코드가 같아도 `product_no`(QR 바인딩) 가 행마다 달라 **행마다 자기 데이터로** 찍어야 한다 (사용자 3번째 고려조건).
- 배송번호 하나에 걸린 최대 규모: 234행 / 1688 주문 5건 / 오퍼 6 / **(오퍼+색상) 조합 11** / product 22. 234행 → 카드 11장으로 줄어든다.
- 배송번호 하나가 여러 `user_id` 에 걸치는 경우 **0건**. (단, `/api/ft/order-items/by-delivery-code` 는 user 필터가 없다 — 11-2 참조)

### 0-3. 현재 V2 저장·출력 흐름 (그대로 계승할 부분)

- 입고 저장 = `POST /api/ft/fulfillments { items: [{type:'ARRIVAL', quantity, order_item_id, operator_name(Worker), user_id, order_no, item_no, product_no, product_id}] }` + 바코드 있는 행은 `saveLabelData()` (`/api/save-fashion-label`, BarTender 용 `invoiceManager_label`). 두 호출은 `Promise.all` (`ItemCheck.tsx` 14장).
- 입력 한도 = `order_qty − ARRIVAL − CANCEL` (RETURN 은 한도에 영향 없음) — `finishEditingCell`.
- 즉시 출력 = `printLabels()` (`app/import-product-v2/utils/printLabels.ts`): **세트 병합(mergeSets: 같은 product_no 중 qty 최대 1건) → 성인/키즈 템플릿 → 로컬 프린터 → TSPL → QZ → `label_print_logs` 기록**. 병합은 **라벨 스티커·케어라벨 양쪽에 똑같이** 적용된다 (→ 12-1 결정 필요).
- `label_print_logs` 는 세트의 **대표 행(order_item_id 1개)** 에만 기록된다. 따라서 "이 세트에 스티커가 몇 장 나갔나" 는 **형제 행 전체의 order_item_id 로 합산**해야 맞다.
- `[모두]` = 저장(안 됐으면) → 라벨 스티커 → 케어 라벨, 중간 실패 시 중단 (`V2ReadyModal.handleRunAll`).

---

## 1. 목표와 범위

### 1-1. 해결할 문제

1. 배송번호 하나에 수십~수백 행이 나와 원하는 행을 찾는 것 자체가 일이다.
2. P 건·세트는 같은 상품이 주문행으로 쪼개져 있어, 10개 입고에 "입고 1" 을 10번(세트면 20번) 입력해야 한다.
3. 세트는 라벨 스티커를 1장만 뽑아야 하는데, 여러 건을 한 번에 작업하면 "언제 누가 뽑았는가" 가 모호해진다.

### 1-2. 범위 안

- 새 메뉴 + 새 페이지 `app/import-product-v3/` (V2 파일은 **동작 변경 없음**, 12-5 의 훅 추출만 예외).
- 검색 결과를 **(오퍼 + 색상) 카드** 로 묶어 표시, 세트는 **하나의 보드** 로 묶음.
- 카드(보드) 클릭 → **대형 모달**: 왼쪽 옵션(사이즈) 목록 + 개수 입력, 오른쪽 해당 옵션의 주문행 목록(진행~출고 열), 하단 `[저장] [라벨 스티커] [케어 라벨] [모두]`.
- 개수 입력 → 주문행 순서대로 자동 배분. 전부 채워지면 초록, 덜 들어오면 주황.
- 세트 라벨 스티커 1회 출력 규칙 (8장) + 부분 입고·순서 역전·취소·다른 배송 등 시나리오 (10장).
- V2 의 나머지 기능(반품·비고·고객확인·운송장·처리 로그·업로드류·V2 이전·Worker/PC-NO/사용자 선택) 은 **기존 컴포넌트를 재사용**해 그대로 제공.

### 1-3. 범위 밖

- V2 페이지의 UX 변경, 세트 케어라벨 병합 동작 수정(12-1 에서 사용자가 "V2 도 고쳐라" 하면 별도 작업).
- 출고(export) 쪽 세트 처리, 라벨 템플릿 편집기.
- 스캐너 입력, 모바일 레이아웃 최적화(태블릿 폭까지만 깨지지 않게).

---

## 2. 용어 정의 (코드 식별자와 1:1)

| 용어 | 정의 | 코드 |
|---|---|---|
| **주문행 (row)** | `ft_order_items` 1행 | `FtOrderItem` |
| **옵션 (option)** | 카드 안에서 **사이즈(`china_option2`)** 가 같은 주문행 묶음 | `OptionGroup` |
| **카드 (card)** | **(오퍼 + 색상)** 이 같은 주문행 묶음 = 이미지 1장 | `Card` |
| **보드 (board)** | 세트 관계로 연결된 카드들의 묶음. 단품 카드는 혼자서 보드 1개 | `Board` |
| **세트 인스턴스 (set instance)** | `product_id` 1개 = 한 주문의 세트 1벌(구성품 n행). P 건은 주문마다 별개 인스턴스 | `SetInstance` |
| **잔여 (remaining)** | 한 주문행에 아직 입고 입력 가능한 수량 = `order_qty − ARRIVAL − CANCEL` | `remainingOf(row)` |
| **배분 (allocation)** | 옵션에 입력한 개수를 주문행별 작업수량으로 나눈 결과 | `Map<rowId, qty>` |
| **배치 (batch)** | 모달 안에서 한 번의 [저장] 단위로 묶이는 배분 전체 (여러 옵션 포함 가능) | `AllocationBatch` |

---

## 3. 화면 설계

### 3-1. 페이지 (`ImportV3.tsx`) — V2 상단은 그대로, 테이블 대신 카드

```
┌ 제목 "상품입고 V3"  [V2 이전]                   [Worker ▾] [PC-NO ▾] [사용자 ▾] ┐
│ SearchSection (상태필터 · 검색유형 · 1688 XLSX / 배송상황 csv / XLSX 다운 / 주문 ID) │
├──────────────────────────────────────────────────────────────────────────────┤
│  카드 그리드 (보드 단위)                                                      │
│  ┌ 단품 보드 ┐ ┌──── SET 보드 (카드 2장 나란히, 공통 테두리 + "SET" 리본) ────┐ │
│  │ [이미지]  │ │ [이미지] 화이트      │ [이미지] 블랙                        │ │
│  │ 상품명    │ │ 옵션 2 · 잔여 20/20  │ 옵션 2 · 잔여 20/20                  │ │
│  │ 藍色      │ └──────────────────────┴──────────────────────────────────────┘ │
│  │ 옵션 1 · 잔여 6/6 │   ...                                                  │
│  └──────────┘                                                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 카드 내용: 이미지(`/api/image-proxy`, `loading="lazy"`), `china_option1`(색상 원문), 대표 `item_name`(한 줄 말줄임), 옵션 수, `잔여 합 / 주문 합`, 상태 띠(아래 3-4).
- 보드 클릭(카드 어디를 눌러도) → 모달. 세트 보드는 카드 2~3장이 **같은 보드 안**에 있고 클릭하면 모달에 구성품이 모두 뜬다.
- 정렬: 검색 결과의 첫 등장 순서(= 서버의 `item_no ASC`) → 작업자가 보던 V2 순서와 같다.
- 우측 액션 사이드바(V2 `RightActionSidebar`)는 **두지 않는다**. 부가 액션은 모달 안으로 (3-3). → 12-4
- 데이터 없음/검색 전 상태: "배송번호를 검색하세요" 안내. 사용자 선택만으로 전체 PROCESSING 을 카드로 펼칠지는 12-9.

### 3-2. 모달 (`CardModal.tsx`) — 뷰포트 92vw × 90vh, 좌 38% / 우 62% 분할

```
┌ 헤더: 상품명 · 오퍼ID(링크) · [반품] [비고] [고객확인] [송장 출력] · ✕ ───────────────┐
│ 왼쪽 (구성품별 블록, 세트면 "SET 1/2 화이트" "SET 2/2 블랙" 순서로 스택)   │ 오른쪽          │
│ ┌ [이미지 크게]                                                       │ 선택한 옵션의     │
│ │ 黑色 · 160cm      [ 10 ]  / 잔여 20 (주문 20)   ● 상태색             │ 주문행 테이블     │
│ │ 黑色 · 170cm      [    ]  / 잔여 10 (주문 10)                        │ ☐ 글번호 상품명   │
│ │ ...                                                                  │   개수 진행 작업  │
│ └                                                                      │   입고 포장 취소  │
│                                                                        │   출고            │
├ 푸터: 요약 "작업 3옵션 · 입고 30개 · 라벨 스티커 10장(세트 중복 제외) · 케어 30장"      │
│       [라벨 스티커 템플릿 ▾] [케어 라벨 템플릿 ▾] (LabelTemplatePicker 재사용)          │
│                                               [저장] [라벨 스티커] [케어 라벨] [모두]    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **옵션 행 클릭** → 그 옵션이 선택되고(오른쪽에 주문행 표시) 개수 입력칸에 **즉시 포커스**.
- 개수 입력 → Enter 또는 blur 시 배분 실행(6장). Enter 는 **다음 옵션 행으로 포커스 이동**(V2 의 Enter→다음 행과 같은 감각). Esc 는 입력 취소.
- 입력칸 placeholder = 잔여 합(최대값). 잔여 0 인 옵션은 입력 비활성 + "입고 완료" 표기.
- **오른쪽 주문행 테이블**: V2 `ItemTableRow` 의 13열 중 모달 폭에 맞게 **글번호(item_no·barcode·1688 order id) / 상품명·옵션(KR, P 배지·운송장 번호 포함) / 개수 / 진행 / 작업(편집 가능) / 입고 / 포장 / 취소 / 출고 / 체크박스** 를 유지. 상품명 클릭 → `FulfillmentLogModal`(V2 재사용). "작업" 셀을 직접 고치면 옵션 입력값은 행 합계로 다시 계산된다.
- 세트 보드에서 **외부 구성품**(이 검색 결과에 없는 형제 행, 7-3) 은 왼쪽 블록에 회색으로 "이 배송에 없음 · 입고 n/주문 m" 으로만 보여 주고 입력은 막는다.

### 3-3. 모달 헤더 부가 액션 (V2 모달 재사용)

| 버튼 | 대상 | 재사용 컴포넌트 | 비고 |
|---|---|---|---|
| 반품 | 오른쪽 테이블에서 체크된 행 (없으면 보드 전체 행) | `V2CancelModal` | V2 와 동일 props (`arrivalMap/cancelMap/returnMap`) |
| 비고 | 체크된 행 | `V2NoteModal` | |
| 고객확인 | 체크된 행 | `V2CustomerConfirmModal` | |
| 송장 출력 | 현재 배치(또는 체크된 행)의 P 상품 | V2 `printInvoicesByOrderNos` 로직 (훅으로 추출, 12-5) | PDF 존재·출력 조합 규칙 그대로 |
| 처리 로그 | 상품명 클릭 | `FulfillmentLogModal` | |

이 모달들은 CardModal 위에 겹쳐 뜨므로 **z-index 를 CardModal 보다 높게** 둔다 (V2 CSS 의 z-index 값 확인 후 CardModal 을 그 아래로).

### 3-4. 상태 색 (옵션 행 · 카드 띠 공통)

| 상태 | 조건 | 색 |
|---|---|---|
| 완료 (green) | 저장 전: `입력값 == 잔여 합` · 저장 후: 옵션의 모든 행 `remaining == 0` | 초록 배경 |
| 부족 (orange) | 저장 전: `0 < 입력값 < 잔여 합` · 저장 후: 옵션에 `ARRIVAL > 0` 인 행이 있는데 `remaining > 0` 인 행도 있음 | 주황 배경 |
| 미작업 | 그 외 | 기본 |
| 초과 (error) | `입력값 > 잔여 합` → 적용 거부 + 메시지("입고 가능 수량 N 초과") + 입력칸 빨간 테두리 1.5초 | — |

카드 띠는 카드 안 옵션들의 상태를 합친다: 모두 완료 → 초록, 하나라도 부족 → 주황, 아니면 없음.

---

## 4. 그룹핑 — 카드 · 옵션 · 보드

### 4-1. 키 (`utils/groupKeys.ts`, 순수 함수)

```ts
export const normOpt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** 오퍼 식별 — 1688_offer_id 우선, 없으면 site_url 의 offer 번호, 그것도 없으면 item_name */
export function offerKeyOf(it: FtOrderItem): string;          // 'offer:971899056500' | 'url:…' | 'name:…'
export function cardKeyOf(it: FtOrderItem): string            // `${offerKeyOf(it)}|${normOpt(it.china_option1) || '-'}`
export function optionKeyOf(it: FtOrderItem): string          // normOpt(it.china_option2) || '-'   (ONE SIZE 는 '-')
export function setInstanceKeyOf(it: FtOrderItem): string | null  // set_total > 1 && product_id ? product_id : null
```

- 색상 키는 `china_option1` **원문** 이다. `HW36`/`HW37` 처럼 색상명이 아닌 SKU 코드가 들어와도 "1688 의 1번 규격" 이므로 그대로 묶는다. 한글 매핑·정규화는 하지 않는다(오분류 위험 > 이득).
- `set_total > 1` 인데 `product_id` 가 없는 행은 단품으로 취급한다 (실측 0건, 방어).

### 4-2. 자료구조 (`hooks/useCardGroups.ts`)

```ts
interface OptionGroup { key: string; size: string; rows: FtOrderItem[];     // rows: item_no ASC 고정
                        orderTotal: number; remainingTotal: number; arrivedTotal: number; }
interface Card        { key: string; offerKey: string; color: string; imgUrl: string | null;
                        title: string; rows: FtOrderItem[]; options: OptionGroup[]; setSeq: number | null; }
interface Board       { key: string; cards: Card[]; isSet: boolean; }
```

알고리즘 (전부 `useMemo`, 입력 = `activeItems` + `arrivalMap` + `cancelMap`):

1. 행 → `cardKeyOf` 로 카드에 적재, 카드 안에서 `optionKeyOf` 로 옵션에 적재. 첫 등장 순서 유지.
2. **보드 결합 = union-find**: `setInstanceKeyOf` 가 같은 행들이 속한 카드끼리 union. 결과 집합이 보드. (화이트 카드와 블랙 카드는 46개의 P 세트 인스턴스로 46번 연결되지만 결과는 보드 1개.)
3. 보드 안 카드 순서 = 그 카드 행들의 최소 `set_seq` → 1/2 화이트, 2/2 블랙.
4. 옵션 정렬 = 사이즈 문자열 `localeCompare(numeric)` (`120 < 130 < 140`, `S < M < L` 은 사전순이라 어긋남 — 12-6 ②).
5. 한 보드에 세트 아닌 카드가 섞이는 경우(같은 오퍼·색상의 단품 주문과 세트 주문이 공존) → 카드는 같지만 옵션 안 행 단위로 `set_total` 이 다르다. 배분·저장은 행 단위라 문제 없고, 라벨 스티커 계산(8장)이 행별 `set_total` 로 분기한다.

### 4-3. 복잡도

최대 검색 결과 수천 행 → O(n α(n)). 카드 이미지는 보드당 1~3장만 로드. 문제 없음.

---

## 5. 데이터 로딩

- `useFtUsers / useFtOrderItems / useFtSearch / useFtFulfillmentSummary` (V2 훅) 그대로 import.
- 배송번호 검색: `GET /api/ft/order-items/by-delivery-code` 그대로 (DONE 포함 전 상태 반환 — 잔여 0 행은 회색 표시).
- `useFtFulfillmentSummary(activeItems ∪ 외부 형제행)` — 모달이 형제행을 가져오면 그 id 도 합계에 포함돼야 8장의 계산이 맞다. 구현: 페이지 레벨 `extraItems` state 에 형제행을 누적하고 `useFtFulfillmentSummary([...activeItems, ...extraItems])` 로 넘긴다 (훅은 id 목록 키로 재조회).
- **모달 열 때** `refreshFulfillments()` 1회 — 다른 PC 가 방금 저장한 ARRIVAL 을 반영해 잔여를 최신화.

---

## 6. 배분 (`utils/distribute.ts`, 순수 함수)

```ts
export interface DistributeRow { id: string; remaining: number; }
export function distribute(rows: DistributeRow[], qty: number)
  : { alloc: Map<string, number>; overflow: number }
```

- rows 는 옵션의 `rows` 순서(`item_no ASC`) 그대로, `remaining <= 0` 은 건너뜀.
- `left = qty; for row: take = min(row.remaining, left); if take > 0 alloc.set(id, take); left -= take;` → `overflow = left`.
- `overflow > 0` 이면 호출 측이 **적용을 거부**한다 (부분 적용 금지 — 작업자가 "10 넣었는데 8만 들어갔네" 를 못 알아채는 것이 더 위험).
- 주문이 2 인 행은 2 까지 채운 뒤 다음 행으로 — 사용자 요구 그대로.
- 행 단위 수동 편집: 오른쪽 "작업" 셀 수정 시 그 행만 바꾸고(한도 = 그 행 remaining) 옵션 입력값 = Σ행. 그 뒤 옵션 입력값을 다시 바꾸면 **자동 배분으로 덮어쓴다** (안내 문구 1줄: "옵션 수량을 바꾸면 행별 수량이 다시 배분됩니다").

### 6-1. 배치 상태 머신 (`hooks/useAllocationBatch.ts`)

```ts
interface AllocationBatch { alloc: Map<string, number>; status: 'editing' | 'saved'; savedAt?: number; }
```

- `editing` 중 입력 변경 → alloc 갱신.
- `[저장]` 성공 → `status='saved'` (alloc 유지 — 이어서 출력에 쓴다). `[저장]` 버튼은 `saved` 동안 비활성("저장 완료").
- `saved` 상태에서 **어떤 옵션이든 새 입력** → 새 배치 시작: `alloc = 그 입력만`, `status='editing'`. (이미 저장된 수량은 `refreshFulfillments` 로 ARRIVAL 에 반영돼 있으므로 다시 담지 않는다.)
- 모달 닫기 → 배치 폐기. `editing` 상태에 alloc 이 있으면 confirm("저장하지 않은 작업 수량이 있습니다. 닫을까요?").
- 출력 버튼은 배치 상태와 무관하게 **현재 배치의 alloc** 으로 동작한다 (V2 도 저장 전 출력 가능).

---

## 7. 저장 — V2 와 동일한 두 호출

`handleSave()` (ImportV3 → 모달에 `onSave: () => Promise<boolean>`):

1. 검증: Worker · PC-NO · 사용자 선택, alloc 비어 있지 않음, 각 행 `qty ≤ remaining` 재검증(모달 열린 사이 다른 PC 저장 가능 → 초과면 거부 + `refreshFulfillments`).
2. `POST /api/ft/fulfillments { items }` — V2 `handleReadySave` 의 payload 그대로 (`type:'ARRIVAL'`, `operator_name: selectedWorker`, `user_id: selectedUserId`, …).
3. 바코드 있는 행 → `saveLabelData({ items, brand, operatorNo: selectedPcNo })` (BarTender 경로 유지, 12-8).
4. 성공 → `batch.status='saved'`, `refreshFulfillments()`, 옵션 상태색 재계산.
5. 이중 클릭 방지: 모달 레벨 `isBusy` 하나로 저장·출력 전부 잠금 (V2 와 동일).

### 7-1. 사용자(user_id) 정합성 (V2 에 없던 방어)

`by-delivery-code` 는 사용자 필터가 없어서, 드롭다운에서 고른 사용자와 검색된 행의 `user_id` 가 다를 수 있다 (실측 0건이지만 저장 payload 의 `user_id` 가 잘못 들어가면 출고·정산에 번진다). V3 는 **검색 결과 행의 `user_id` 가 선택 사용자와 다르면 저장을 거부**하고 "선택한 사용자와 다른 사용자의 주문이 포함되어 있습니다 (사용자코드 X)" 를 띄운다. 이를 위해 `FT_ORDER_ITEMS_DISPLAY_SELECT` 에 `user_id` 를 추가한다 (V2 화면엔 영향 없음 — 컬럼 하나 더 내려올 뿐). → 12-7

---

## 8. 라벨 출력 규칙 — 세트 라벨 스티커 "1세트 1장" 추적 (핵심)

### 8-1. 원칙

- **라벨 스티커(barcode)** : 세트는 **세트 인스턴스(product_id) 당 1장 × 세트 수**. 어느 구성품이 먼저 오든 **처음 도착할 때 도착 수량만큼 뽑고**, 나중 구성품은 **이미 뽑힌 만큼 건너뛴다**. 근거 데이터는 `label_print_logs` (DB) 이므로 PC·세션·날짜가 달라도 이어진다.
- **케어 라벨(care)** : **구성품(행)마다 자기 수량**. 화이트 10 + 블랙 10 = 케어 20장. (V2 의 `printLabels` 는 케어도 세트 병합한다 → V3 에서는 병합을 끈다. 12-1)
- 단품은 둘 다 행 수량 그대로.

### 8-2. 계산 (`utils/stickerPlan.ts`, 순수 함수)

세트 인스턴스 S, 구성품 p ∈ parts(S) (검색 결과 + 외부 형제행 전부):

```
cap(S)        = min_p ( order_qty_p − cancel_p )                 // 만들 수 있는 최대 세트 수
arrived(p)    = ARRIVAL_p(DB)  +  (배치가 'editing' 이면 alloc_p, 'saved' 면 0)
target(S)     = min( cap(S), max_p arrived(p) )                  // 지금까지 필요한 스티커 누적 장수
printed(S)    = Σ_{p} label_print_logs.qty  where label_type='barcode' and order_item_id = p.id
toPrint(S)    = max( 0, target(S) − printed(S) )
대표행(S)      = 이번 배치에 포함된 구성품 중 set_seq 최소 (없으면 parts 중 set_seq 최소)
```

- `max_p` 를 쓰는 이유: "먼저 온 구성품 수량만큼 즉시 출력" 이라는 운영 요구. `min_p`(완성 세트 수) 로 하면 화이트만 왔을 때 0장이 되어 요구와 어긋난다.
- `cap` 으로 자르는 이유: 블랙이 전부 취소된 세트는 화이트가 와도 팔 수 없다 → 스티커 낭비 방지. (취소가 **스티커 출력 뒤에** 들어오면 되돌릴 수 없다 — 허용.)
- `printed` 는 **출력 직전에 서버에서 다시 조회**한다 (페이지 state 의 캐시가 아니라). 두 PC 동시 작업의 창을 최소화.
- 스티커 바인딩 데이터는 구성품끼리 동일(바코드·product_no·item_name·option_name 공유) 하므로 대표행 선택이 출력물에 영향을 주지 않는다. 템플릿이 `china_option1` 을 바인딩한다면 색상만 달라질 수 있다 — 라벨 설정 확인 항목으로 QA 체크리스트에 넣는다.

출력 행 구성:

```ts
export interface StickerPlan {
  rows: { item: FtOrderItem; qty: number }[];          // printLabels 에 넘길 행 (단품 행 + 세트 대표행)
  sets: { productId: string; cap: number; target: number; printed: number; toPrint: number; rep: FtOrderItem }[];
  skippedSheets: number;                                // Σ(alloc of set rows) − Σ toPrint — "세트 중복 제외 −M장" 표시용
}
export function planStickers(input: {
  alloc: Map<string, number>; rowsById: Map<string, FtOrderItem>;
  partsByProductId: Map<string, FtOrderItem[]>;        // 형제 포함
  arrivalMap: Map<string, number>; cancelMap: Map<string, number>;
  printedBarcodeByItem: Map<string, number>; includePending: boolean;
}): StickerPlan
```

케어 라벨 행 = `alloc` 의 모든 바코드 있는 행 그대로 (`{ item, qty }`), 병합 없음.

### 8-3. 출력 실행

- `printLabels()` 에 **옵션 `mergeSets?: boolean` (기본 true)** 를 추가한다. V3 는 스티커·케어 모두 `mergeSets:false` 로 호출한다 (스티커는 `planStickers` 가 이미 세트를 접었고, 케어는 접지 않아야 하므로). V2 호출부는 인자를 안 넘기니 동작 불변.
- 기록은 `printLabels` 내부의 `label_print_logs` 그대로 — 세트 대표행 `order_item_id` 에 `toPrint` 가 남는다 → 다음 계산의 `printed(S)` 에 합산된다. **인쇄 실패 시 기록이 남지 않으므로 재시도하면 같은 장수가 다시 계산된다** (올바른 성질).
- `toPrint` 합이 0 이면 `[라벨 스티커]` 버튼은 "0장 (세트 스티커 출력됨)" 로 표시·비활성, `[모두]` 는 **스티커 단계를 성공으로 간주하고 건너뛴다** (V2 `printOne` 은 0건이면 실패로 멈추므로 V3 전용 `runAll` 로 작성).

### 8-4. 수량 가시화와 수동 보정 (12-2)

푸터 요약에 "라벨 스티커 **10장** (세트 중복 제외 −10장)" 을 항상 보여 주고, 숫자를 클릭하면 세트별 표(`product_id 앞 8자리 · cap/target/printed/toPrint`)와 **"장수 직접 지정"** 입력이 열린다. 필요한 이유: `label_print_logs` 는 2026-09-08 부터만 있다 → 그 전에 BarTender 로 뽑은 세트의 뒤늦은 구성품이 지금 들어오면 계산상 `printed=0` 이라 **중복 출력**된다. 작업자가 눈으로 0 으로 고칠 수 있어야 한다. 수동 지정값은 그 배치에만 적용, 기록은 실제 출력 장수로 남는다.

---

## 9. `[모두]` 순서 (V3 전용 `runAll`)

```
1) batch.status==='editing' → save(); 실패면 중단
2) stickerPlan 재계산(printed 서버 재조회) → toPrint 합 > 0 이면 printLabels(barcode, mergeSets:false); 실패면 중단. 0 이면 "건너뜀" 플래시
3) printLabels(care, 모든 alloc 행, mergeSets:false)
```

각 단계 결과를 푸터에 플래시("저장 ✓ · 스티커 10장 ✓ · 케어 20장 ✓") 로 3초 표시. 세트 보드에서 **옵션을 연달아** 작업하는 흐름: 화이트 S 10 → [모두] → 블랙 S 10 입력(새 배치 자동 시작) → [모두] → 스티커 0장 건너뜀, 케어 10장.

---

## 10. 시나리오 — 반드시 검수할 것 (QA 체크리스트의 원본)

표기: W=화이트, B=블랙 (SET, 주문 10/10). 기대값은 `[저장 ARRIVAL / 스티커 / 케어]`.

| # | 상황 | 기대 동작 |
|---|---|---|
| S1 | W S 10 → [모두]; 다음에 B S 10 → [모두] | 1차: `10 / 10 / 10(W)` · 2차: `10 / 0(건너뜀) / 10(B)` |
| S2 | W S 10 → [모두]; B S **9** → [모두]; 나중에 B 1 → [모두] | 2차: `9 / 0 / 9` · 3차: `1 / 0 / 1` (target 10, printed 10) |
| S3 | W S **8** → [모두]; B S 10 → [모두]; 나중에 W 2 | 1차 `8/8/8` · 2차 `10/2/10` (target 10, printed 8) · 3차 `2/0/2` |
| S4 | W 10 과 B 10 을 **같은 배치**에 넣고 [모두] 1번 | `20 / 10 / 20` |
| S5 | B 가 전부 CANCEL(10) 된 세트, W 10 입고 | `10 / 0 / 10` (cap 0) |
| S6 | B 2 만 CANCEL, W 10 입고 | `10 / 8 / 10` (cap 8) |
| S7 | P 세트 46 인스턴스, W 130cm 에 46 입력 | 46행에 1씩, 스티커 **46장(행마다 다른 product_no)**, 케어 46 |
| S8 | S7 뒤 B 130cm 에 46 | `46 / 0 / 46` |
| S9 | 세트 구성품이 **다른 1688 주문**(13건/1,320) — 이 배송번호엔 W 만 | 모달에 B 는 "이 배송에 없음" 회색 블록으로 표시, 스티커 계산엔 B 의 DB ARRIVAL 반영. W 10 → `10/10/10` |
| S10 | 2026-09-08 이전에 W 가 BarTender 로 출력·입고된 세트, 지금 B 입고 | 계산상 스티커 10장 → 푸터 숫자 보고 **"장수 직접 지정" 0** 으로 보정 가능해야 함 |
| S11 | 저장 성공 후 스티커 인쇄 실패(QZ 꺼짐) | [모두] 중단, 저장은 유지, `[라벨 스티커]` 재시도 시 같은 장수(기록 안 남았으므로) |
| S12 | 저장 안 하고 `[라벨 스티커]` 먼저 → 모달 닫고 저장 안 함 | 기록은 남고 ARRIVAL 없음 → 다음에 같은 세트 입고 시 target ≤ printed 라 0장 (실물 스티커는 이미 있음) — 허용, 안내 문구 |
| S13 | 처리 로그 모달에서 ARRIVAL 삭제 후 재입고 | target 감소·printed 유지 → 재입고 시 0장 (실물 존재) |
| S14 | 두 PC 가 같은 세트를 동시에 작업 | 출력 직전 서버 재조회로 창 최소화; 완전 차단은 아님 (문구로 안내, 범위 밖) |
| S15 | 옵션 입력 > 잔여 합 | 적용 거부, 메시지에 최대값, 입력칸 빨간 테두리 |
| S16 | 옵션 안에 잔여 0 행(DONE·이미 입고)이 섞임 | 배분에서 건너뜀, 오른쪽 테이블엔 회색 표시 |
| S17 | 행 수동 편집으로 작업수량 조정 후 옵션 입력값 재입력 | 자동 배분이 덮어씀 (안내 문구) |
| S18 | 바코드 없는 행 포함 | ARRIVAL 은 저장, 라벨 대상에서 제외 (V2 동일) |
| S19 | 모달 열린 사이 다른 PC 가 같은 행에 ARRIVAL 저장 | 저장 시 한도 재검증 실패 → 거부 + 최신화 |
| S20 | 사용자 드롭다운과 검색 결과의 `user_id` 불일치 | 저장 거부 (7-1) |
| S21 | 세트 주문과 단품 주문이 같은 (오퍼+색상) 카드에 공존 | 같은 옵션 안에서 행별 `set_total` 로 분기, 단품 행은 행 수량대로 스티커 |
| S22 | 성인/키즈 혼재 보드 | `useLabelTemplatePlan` 이 대상별 템플릿 자동 선택 (V2 동일), 없으면 버튼 잠김 |
| S23 | `[모두]` 도중 모달 닫기 시도 | `isBusy` 동안 닫기 버튼 비활성 |
| S24 | 일반검색/주문번호/비고검색 결과 | 같은 카드 그리드로 표시 (배송번호 전용 아님) |
| S25 | 1688 주문이 여러 배송번호로 분할 발송 | `by-delivery-code` 는 주문 단위로 돌려주므로 아직 안 온 구성품도 결과에 포함 — 잔여만 보고 작업, 스티커는 8장 규칙대로 |

---

## 11. 파일 구조와 API

### 11-1. 새 파일

```
app/import-product-v3/
  page.tsx                         // thin
  ImportV3.tsx                     // 오케스트레이터 (상단 드롭다운·검색·카드 그리드·모달 연결) — 400행 이하 유지
  ImportV3.css
  components/
    BoardGrid.tsx / BoardGrid.css        // 보드 레이아웃 (세트 보드 span)
    ProductCard.tsx                      // 카드 1장
    CardModal.tsx / CardModal.css        // 대형 모달 틀 + 헤더 액션 + 푸터
    OptionList.tsx                       // 왼쪽: 구성품 블록 + 옵션 행 + 입력
    OrderRowTable.tsx                    // 오른쪽: 주문행 테이블 (작업 셀 편집, 체크박스)
    StickerPlanPopover.tsx               // 세트별 스티커 계산표 + 직접 지정
  hooks/
    useCardGroups.ts                     // 4장
    useAllocationBatch.ts                // 6-1
    useSetSiblings.ts                    // 모달 열 때 product_id 로 외부 형제행 lazy fetch
    useStickerPlan.ts                    // 8장 (printed 서버 조회 포함)
    useV3Print.ts                        // runAll / printOne (9장)
  utils/
    groupKeys.ts  distribute.ts  stickerPlan.ts    // 순수 함수 — 13장 Phase 1 에서 스크립트로 검증
app/api/label-print-logs/summary/route.ts        // 11-2 ①
app/api/ft/order-items/by-product-ids/route.ts   // 11-2 ②
```

CSS 접두사 `v3-`. 구획 주석 규칙(`/* ===== */`, `// ── 소제목 ──`) 준수. 색상·크기 매직넘버는 `:root` 변수(`--v3-ok`, `--v3-warn`) 로.

### 11-2. API 추가·변경

① `POST /api/label-print-logs/summary` `{ order_item_ids: string[] }` → `{ success, data: { [order_item_id]: { barcode: number; care: number } } }`
   - 100개 단위 `.in()` 배치 + `range()` 1000행 페이지네이션 (`lib/confirmDone.ts` `fetchAll` 패턴). `label_type` 별 `qty` 합.

② `POST /api/ft/order-items/by-product-ids` `{ product_ids: string[] }` → `FtOrderItem[]` (`FT_ORDER_ITEMS_DISPLAY_SELECT`, `item_no ASC`)
   - 모달 열 때 보드 안 `set_total > 1` 행들의 `product_id` 로 호출, 결과 중 `activeItems` 에 없는 행만 외부 형제로 추가. 배치·페이지네이션 동일.

③ `lib/ftOrderItemsSelect.ts` 에 `user_id` 추가 (7-1). `FtOrderItem` 타입에 `user_id?: string | null`.

④ `app/import-product-v2/utils/printLabels.ts` — `PrintLabelParams.mergeSets?: boolean` (기본 `true`). `mergeSets === false` 면 `mergeSets()` 건너뜀. 주석에 V3 가 왜 끄는지 명시.

⑤ 메뉴: `component/LeftsideMenu.tsx` 상품입고 `<li>` 다음에 `/import-product-v3` "상품입고V3" (아이콘은 `importProduct` 재사용 + 작은 "V3" 뱃지 텍스트, 또는 별도 아이콘 — 구현자 재량). `handleNavigation` 동일.

⑥ i18n: `locales/ko.json` / `zh.json` 에 `importProductV3` 네임스페이스 (title, 상태 문구, 푸터 요약, 경고 문구). V2 키(`importProductV2.*`, `importProduct.processReady.*`) 는 그대로 재사용 가능한 것은 재사용. **두 파일 동시 추가**.

### 11-3. V2 에서 가져다 쓰는 것 (수정 없이 import)

`useFtUsers / useFtOrderItems / useFtSearch / useFtFulfillmentSummary / FtOrderItem / FtUser`, `useLabelTemplatePlan`, `LabelTemplatePicker`, `SearchSection`, `V2CancelModal`, `V2NoteModal`, `V2CustomerConfirmModal`, `FulfillmentLogModal`, `saveLabelData`, `printLabels`(④ 옵션만 추가), `lib/sizeCode.resolveSizeBadge`, `lib/invoicePdfClient.mergeAndPrint`.

### 11-4. V2 `ItemCheck.tsx` 안에 인라인으로 있어 V3 가 못 쓰는 것 (12-5)

업로드 4종(1688 XLSX·배송상황 csv·XLSX 다운·주문 ID) + V2 이전 + Worker 목록 로드 + P 송장 출력(`printInvoicesByOrderNos`, PDF 존재·출력 이력 조회 2개 effect). 약 450행. 권장: `app/import-product-v2/hooks/useImportUploads.ts`, `useWorkers.ts`, `usePersonalInvoicePrint.ts` 로 **그대로 옮기고** V2 `ItemCheck.tsx` 도 그 훅을 쓰도록 바꾼다 (동작 불변, `npm run type-check` 로 확인). 대안은 V3 에 복사(중복 450행).

---

## 12. 결정 필요 사항 — 구현 시작 전에 사용자 답을 받을 것

| # | 질문 | 권장안 |
|---|---|---|
| 12-1 | **세트 케어라벨**: V3 는 구성품마다 찍는다(화이트 10 + 블랙 10). V2 는 지금 세트 병합으로 10장만 찍는다. V3 만 바꿀지, V2 도 같이 고칠지? | V3 만 (이번 범위). V2 는 별도 확인 후 |
| 12-2 | 세트 스티커 **장수 직접 지정** UI 를 넣을지 (레거시 BarTender 출력분 보정용) | 넣는다 (8-4) |
| 12-3 | 세트 스티커 상한 `cap = min(order_qty − cancel)` 에 **RETURN 도 뺄지** | 안 뺀다 (반품은 입고 후 사건, 스티커는 이미 붙었음) |
| 12-4 | 반품·비고·고객확인·송장 출력 버튼 위치: 모달 헤더 (권장) vs 페이지 우측 사이드바 유지 | 모달 헤더 — 선택 대상(체크박스)이 모달 안에 있으므로 |
| 12-5 | V2 인라인 핸들러를 훅으로 추출해 공용화 vs V3 에 복사 | 추출 (11-4). V2 `ItemCheck.tsx` 를 건드리는 유일한 변경 |
| 12-6 | ① 배분 순서 = `item_no ASC` (현재 화면 순서) ② 옵션(사이즈) 정렬 = 문자열 numeric 사전순 | ① 그대로 ② 그대로 (S/M/L 은 등장 순서 fallback 가능) |
| 12-7 | `user_id` 불일치 시 **저장 거부** vs 경고만 | 거부 (출고·정산 오염 방지) |
| 12-8 | `saveLabelData`(BarTender `invoiceManager_label`) 호출을 V3 도 유지할지 | 유지 (53행 — 아직 쓰는 PC 가 있을 수 있음). 확인되면 제거 |
| 12-9 | 사용자만 선택했을 때 전체 PROCESSING(수백~수천 행)을 카드로 펼칠지, 검색 후에만 보여줄지 | 검색 후에만 + "전체 보기" 체크박스 |
| 12-10 | 카드 그룹 키에 `china_option1` 원문 사용 (색상명 아닌 SKU 코드도 그대로) | 그대로 |

---

## 13. 작업 순서 (Opus 5.5 용)

각 Phase 끝에 `npm run type-check`. 커밋은 Phase 단위.

**Phase 0 — 뼈대** (0.5일)
- 메뉴 항목(⑤), `app/import-product-v3/page.tsx` + 빈 `ImportV3.tsx/.css`, i18n 키(⑥) ko/zh 동시.
- `FT_ORDER_ITEMS_DISPLAY_SELECT` 에 `user_id` (③). V2 화면 깨지지 않는지 확인.

**Phase 1 — 순수 함수 + 검증 스크립트** (0.5일)
- `utils/groupKeys.ts`, `distribute.ts`, `stickerPlan.ts`.
- 스크래치 디렉터리에 `tsx`/`ts-node` 스크립트로 **10장 S1~S8, S15, S21** 을 입력→기대값 표로 실행해 통과 확인 (프로젝트엔 테스트 러너가 없으므로 저장소에 넣지 않고 결과만 커밋 메시지·PR 에 기록).

**Phase 2 — API** (0.5일)
- `label-print-logs/summary` (①), `order-items/by-product-ids` (②), `printLabels.mergeSets` (④).
- 각 API: 건수 확인 주석 + 배치/페이지네이션. V2 `[라벨 스티커]` 가 이전과 똑같이 찍히는지 1회 실물 확인(④ 기본값 불변 검증).

**Phase 3 — V2 훅 추출** (0.5일, 12-5 승인 시)
- `useImportUploads / useWorkers / usePersonalInvoicePrint` 로 이동, V2 `ItemCheck.tsx` 치환. 동작 불변 — V2 에서 업로드 버튼 4종·V2 이전·운송장 1회씩 실행 확인.

**Phase 4 — 카드 그리드** (1일)
- `useCardGroups`, `BoardGrid`, `ProductCard`. 실데이터로 배송번호 1개(세트 포함) 검색해 보드 묶임·순서·상태 띠 확인.

**Phase 5 — 모달** (1.5일)
- `CardModal`, `OptionList`, `OrderRowTable`, `useAllocationBatch`, `useSetSiblings`. 입력→배분→행 테이블 반영, Enter 이동, 초과 거부, 수동 편집 합산, 외부 형제 회색 블록.

**Phase 6 — 저장·출력·[모두]** (1일)
- `useStickerPlan`, `useV3Print`, `StickerPlanPopover`, 푸터. S1~S13 을 **테스트 사용자/테스트 주문**으로 실제 QZ 출력까지 1회씩. (운영 데이터에 ARRIVAL 이 남으므로 테스트 뒤 처리 로그 모달에서 삭제.)

**Phase 7 — 부가 액션 + 마무리** (0.5일)
- 헤더 액션 5종 연결(3-3), z-index, 닫기 confirm, 태블릿 폭 확인, CSS 구획 주석, `console.log` 없음 확인, ko/zh 누락 키 점검.

### 13-1. 검수 체크리스트 (PR 설명에 그대로 붙일 것)

- [ ] 10장 S1~S25 각각 "확인함/해당없음" 과 근거(스크린샷 또는 로그 id)
- [ ] V2 페이지 회귀: 검색·입고 저장·라벨 스티커·케어·[모두]·운송장·업로드 4종·V2 이전 각 1회
- [ ] `label_print_logs` 에 세트 대표행 1건만 남는지 (S1 뒤 SQL 로 확인)
- [ ] `ft_fulfillment_inbounds` 에 행별 ARRIVAL 이 정확히 alloc 대로 들어갔는지 (S7 뒤 46행 1씩)
- [ ] 두 PC 시나리오(S14·S19) 수동 재현
- [ ] `npm run type-check` 통과, 신규 파일 전부 구획 주석, 하드코딩 없음(PC-NO 옵션은 V2 상수 재사용)

---

## 14. 알려진 한계 (문서화만)

- 세트 스티커 추적은 2026-09-08 이후 기록에만 의존한다 → 8-4 의 수동 지정으로 보정.
- 동시 작업 완전 차단은 없다 (DB 유니크 제약이 없고 V2 도 동일).
- `printLabels` 가 QZ 전송 성공을 "인쇄 성공" 으로 본다 — 프린터 걸림으로 일부만 나와도 기록은 전량 남는다 (V2 동일). 이 경우도 8-4 수동 지정으로 재출력.

---

## 15. 구현 결과 (2026-10-18)

### 15-1. 12장 결정 — 사용자 답 없이 권장안 그대로 채택

12-1 V3 만 케어라벨 구성품별 · 12-2 직접 지정 UI 포함 · 12-3 RETURN 미차감 · 12-4 모달 헤더 · 12-5 훅 추출 · 12-6 item_no 순 / 숫자 인식 사전순 · 12-7 저장 거부 · 12-8 BarTender 저장 유지 · 12-9 검색 후 + [전체 보기] · 12-10 원문 키.

### 15-2. 계획과 달라진 점

- 순수 함수에 `utils/buildBoards.ts` 추가 — 카드·옵션·보드 구성(union-find)을 훅에서 분리해 검증 스크립트로 돌릴 수 있게 했다. `useCardGroups` 는 메모이즈만 한다.
- 저장·출력 핸들러는 `hooks/useInboundActions.ts` 로 분리 (ImportV3.tsx 는 467행 — 400행 목표보다 조금 길다. 대부분 JSX).
- V2 훅 추출에 버튼 마크업도 포함: `components/ImportUploadButtons.tsx` (`ImportUploadButtons` + `V2MigrationButton`). 마크업·문구 동일.
- `SearchSection` 에 선택 prop `groupToggleLabel` 추가 — V3 가 같은 체크박스를 [전체 보기] 로 재사용. 미지정 시 V2 문구 그대로.
- 출력 기록의 `printed_by` 를 V3 는 Worker 값으로 남긴다 (V2 는 null).
- 세트 구성품이 한 장뿐인 카드(나머지 구성품이 다른 배송)도 카드·모달에 "SET n/m" 을 표시한다 (보드 테두리는 카드 2장 이상일 때만).
- 출력 직전 계산(`useStickerPlan.buildFresh`)은 구성품을 `by-product-ids` 로 다시 받고, 입고/취소는 기존 `POST /api/ft/fulfillments` 조회 모드를 쓴다.

### 15-3. 검증

- `npm run type-check` 통과.
- 순수 함수: 스크래치 스크립트로 33건 통과 — S1~S8, S10(직접 지정), S15, S18, S21, 저장 후 이중 계산 없음, 대표 행 선택, 보드 묶음·순서·상태.
- 브라우저(로컬 dev, 운영 DB **읽기만** — 저장·출력 버튼은 누르지 않음):
  - `YT7649660185816` (P 세트): 카드 2장이 SET 보드 1개로 묶임 → 杏色 5 입력 시 주황 + 다음 옵션 포커스, 黑色 7 입력 시 초록 + 7행에 1씩 배분, 푸터 "라벨 스티커 7장 (세트 중복 제외 −5장) · 케어 12장", 계산표 7세트(최대1·필요1·출력됨0·이번1)
  - 9 입력(잔여 7) → 거부·빨간 테두리·되돌림·안내 문구
  - `79039517447937`: 다른 배송의 구성품이 "이 배송에 없음" 회색 블록(입고 0 / 주문 3)으로 표시, 스티커 3장
  - 처리 로그 서랍·반품 모달이 카드 모달 위에 뜸, 저장 안 한 입력이 있으면 닫기 확인
  - V2 페이지 회귀: 사용자 선택 → 목록·Worker·업로드 버튼·V2 이전 정상 렌더
- 로컬 dev 에서 `/api/ft/personal-invoices/check` 가 500 — `STOCK_SUPABASE_URL` 미설정 환경 문제로 V2 도 동일. 운송장 버튼은 로컬에서 검증 불가.

### 15-4. 아직 확인하지 않은 것 (운영 데이터에 쓰기가 필요)

- 실제 [저장] → ARRIVAL 행별 기록 (S7 46행 1씩), [라벨 스티커]·[케어 라벨]·[모두] QZ 실출력, `label_print_logs` 대표 행 1건 기록 (S1~S3 의 2차 출력 0장).
- S11~S14, S19(두 PC), S20(사용자 불일치), 운송장 출력.
- 테스트 사용자/테스트 주문으로 한 번씩 돌린 뒤 처리 로그 모달에서 ARRIVAL 을 지우는 방식으로 확인 권장.

### 15-5. 사용자 피드백 반영 (2026-10-18 ~ 10-19)

- 업로드 버튼([V2 이전] [1688 XLSX] [XLSX 다운] [주문 ID])을 V3 에서 빼고 `/order-status-v2` 로 옮김. [배송상황 csv] 는 그 페이지에 이미 있어 중복 추가하지 않음. 상품입고 V2 의 버튼은 그대로.
- 오른쪽 표 '작업' 칸에 수량이 들어가면 배경이 연하게 깜빡임 (`v3-work-input--filled`).
- 모달 왼쪽을 "색상별 블록" → "사이즈 → 색상" 순 목록으로 변경 (130 화이트, 130 블랙, 140 화이트 …). 위쪽에 색상별 이미지 범례.
- 세트는 한 색상씩 처리하도록 강제: 저장 안 한 입력이 있는 색상이 있으면 다른 색상 줄은 흐리게 + 입력 잠금, 오른쪽 표 입력도 거부. Enter 는 같은 색상의 다음 사이즈로만 이동하고 마지막 사이즈에서 멈춤.
- 푸터에 케어라벨 색상명 표시, 세트 스티커 출력 대상이 있으면 "먼저 온 색상 묶음과 보관" 안내.
- 79038348149853 조사: 남은 Q69A 140 4세트는 1688 주문 5127744600793007433 이 판매자 미발송 상태에서 같은 송장번호로 수령 처리된 건. V3 의 item_no 순 배분이 이런 주문에 먼저 들어갈 수 있음 → 배분 우선순위(1688 수령 확인 순) 검토 필요.
