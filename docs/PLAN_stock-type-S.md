# 작업 계획 — 보관(STOCK) 경로 + 재고 페이지([작업중] · [재고])

작성일: 2026-11-02 · 상태: **구현 완료 (2026-11-02)** — 구현 중 바뀐 결정은 §6 의 9~13
대상
- 1688-invoice: `/storage/*`(신규 2페이지), `/api/ft/storage/*`(신규), `/export-product-v2`(목록 제외), `/order-status-v2`(배지·토글·확인필요), 좌측 메뉴, i18n, pageTableMap
- purchase-agent: 장바구니 "보관" 선택, 주문 진행 배지·토글·확인필요 (`lib/sizeCode.ts`, `lib/deliveryAlerts.ts`)
- Supabase(manage-item, `mkcxpkblohioqboemmah`): `ft_order_items` 컬럼 1개 + 신규 테이블 2개 + 함수 3개 + 뷰 1개 (`supabase/storage/001_storage.sql`)
- 이전 계획 `docs/PLAN_shipment-v2_redesign_move-requests.md` §3 결정 3 "S(보관) 처리는 별도 계획" 의 후속

---

## 0. 조사 요약 (코드 + 운영 DB 실측, 2026-11-02)

### 0-1. 지금 상품이 흐르는 길

```
고객(purchase-agent)          창고(1688-invoice)
장바구니 status='new'  ──▶  ft_order_items PROCESSING
  shipment_type =                 │
  COUPANG/PERSONAL/DIRECT         ▼
                           상품입고 V2/V3  → ft_fulfillment_inbounds  type=ARRIVAL
                                  │
                                  ▼
                           상품출고 V2 (주문번호 라벨 스캔 → 박스)
                                  → ft_fulfillment_outbounds type=PACKED, box_code, box_info_id
                                  │
                                  ▼
                           쉽먼트 V2 (박스 단위 [출고]) → ft_shipments, outbounds.shipment_id
                                  │
                                  ▼
                           출고완료 → 확정(shipment-details) → confirmDone → status=DONE
```

- 타입 → 코드 판정은 한 곳: `lib/sizeCode.ts resolveSizeBadge / resolveScanSizeCode` (purchase-agent 에 **같은 파일의 사본**과 `TYPE_FIELD_MAP` 이 있다 — 바꾸면 양쪽 같이).
- `A/B/C/P/X` 는 **박스 타입이면서 상품 사이즈 코드**다. 스캔 검증(`export-product-v2`), 쉽먼트 에러(`shipment-v2/utils/shipmentCodes.ts`), 이동요청 `target_type CHECK`, 부자재 `size_code CHECK`, 박스코드 `{user_code}-{타입}-{번호}` 가 전부 이 5종을 전제로 한다.
- 출고가능수량(상품출고 V2) = `MIN over 세트 sibling (ARRIVAL − PACKED − RETURN)`. 스캔 키는 **주문번호 라벨(product_no, `BZ-260224-0202-A01 → BZ-260224-0202` 정규화)**.
- DONE 판정(`lib/confirmDone.ts`) = `order_qty − 취소/반품(DONE) − 출고확정 PACKED(product_id 기준) ≤ 0`. 입고만 된 상품은 PROCESSING 유지.
- 주문상태 V2 [⚠️ 확인필요](`utils/deliveryAlerts.ts`): **입고가 다 된 뒤 5일 지나도 포장이 안 되면 '포장 지연'** — 보관 상품은 이 규칙에 전부 걸린다 (purchase-agent `lib/deliveryAlerts.ts` 도 동일).

### 0-2. 운영 DB

| 테이블 | 건수 | 비고 |
|---|---|---|
| `ft_order_items` | 40,913 | `shipment_type` PERSONAL 20,710 / COUPANG 15,948 / DIRECT 4,255 — NULL 0, CHECK 없음. status DONE 37,931 / PROCESSING 2,935 / new 47. PROCESSING 중 `product_id` NULL **0**. RLS 끔(anon 읽기) |
| `ft_fulfillment_inbounds` | 43,222 | ARRIVAL 37,820 / CANCEL 2,277 / RETURN 3,118. `type CHECK` 3종. RLS 끔 |
| `ft_fulfillment_outbounds` | 29,671 | 전부 PACKED. 미출고 781. RLS 끔 |
| `ft_box_info` | 2,259 | 열린 박스 108. type A 1,556 / P 339 / X 196 / B 116 / C 52 |
| `ft_users` | 5 | 진행 중 주문 보유 4 |

- 1000행: 보관 대상 행은 적지만 조회는 전부 `fetchAll`/`batchIn`(`app/api/ft/shipment-v2/route.ts`) 패턴.
- 별도 저장소 `~/Projects/stock_management`(immong-stocks) 와 `lib/stockSupabase.ts` 는 **쿠팡 로켓 재고용 다른 시스템** — 무관. 이름 충돌을 피해 이번 페이지는 `/storage`, 메뉴 "재고(보관)".

---

## 1. 개념 정의 — 모순이 생기지 않게 먼저 고정

### 1-1. 두 개의 독립된 축 (2차 검토 결정)

| 축 | 질문 | 값 | 컬럼 |
|---|---|---|---|
| 포장 타입 | 어떤 박스로 보낼 물건인가 | A/B/C/P/X | `shipment_type` + `coupang_shipment_size` (**변경 없음**) |
| 입고 후 경로 | 입고되면 바로 쉽먼트로 가는가, 보관하는가 | SHIPMENT / STOCK | **`arrival_route` 신규** |

- 1차 안(`shipment_type='STOCK'` 6번째 값)은 **폐기**. 그 방식은 "어떤 박스로 보낼지" 정보를 잃어 스캔 검증·쉽먼트 에러·처리속도·물량관리 곳곳에 S 예외가 퍼진다.
- 보관 상품도 **A/B/C/P/X 타입을 가진다.** 재고 → 쉽먼트 때 박스 타입 검증을 일반 스캔과 같은 규칙으로 한다.
- 화면에서는 기존 `[A]` 배지 옆에 노란 `[S]` 칩 (STOCK 일 때만). 이용자 눈에는 "같은 줄" 이지만 데이터는 분리.

### 1-2. 보관 상품의 생애

```
ARRIVAL (입고 V2/V3, 변경 없음)
   │  arrival_route = STOCK 인 입고 건만
   ▼
[작업중]  미배치 수량 = ARRIVAL.quantity − Σ PUTAWAY(이 입고 건)
   │  위치 스캔 + 수량 → PUTAWAY
   ▼
[재고]    위치별 수량 = Σ PUTAWAY − Σ PICK − Σ ADJUST   (product_id × location)
   │  [쉽먼트] 위치·수량 선택 + 박스 → PICK + PACKED 행 (한 트랜잭션)
   ▼
쉽먼트 V2 이후는 일반 PACKED 행과 완전히 동일 → 출고 → 확정 → DONE
```

| 항목 | 정의 |
|---|---|
| 작업중 한 줄 | **입고 건(ARRIVAL 행) 1건** (2차 결정). 같은 상품이 두 번 입고되면 두 줄. 부분 배치하면 같은 줄에 잔량 표시 |
| 분리 보관 | 한 입고 건을 여러 위치에 나눠 PUTAWAY — 같은 상품이 위치마다 수량 다르게 존재 가능 |
| 재고 한 줄 | **product_id × location** (세트상품은 product_id 로 묶임 — 상품출고 V2·confirmDone 과 같은 단위) |
| 위치 코드 | 자유 형식 텍스트. USB 바코드 리더가 "값 + Enter" 로 넣으므로 입력창 Enter 로 확정. 위치는 **첫 스캔 때 자동 등록**(사전 등록 없이도 동작, §6 결정 3) |
| 추천 위치 | ① 같은 바코드(`ft_order_items.barcode`)가 이미 보관된 위치 → ② 없으면 같은 `1688_offer_id` 가 보관된 위치 → ③ 없으면 추천 없음 (2차 결정) |
| 상단 스캔 키 | **주문번호 라벨(product_no)만** — 상품출고 V2 와 같은 정규화. 바코드 없는 상품도 라벨은 있으므로 공백 없음 |
| 상태 | 보관 중 = PROCESSING. DONE 공식 불변. 부분 출고 잔량은 PROCESSING |
| `arrival_route` 값은 바뀌지 않는다 | 재고에서 쉽먼트로 보내도 STOCK 그대로 (고객이 보관으로 주문했다는 사실). "지금 어디 있는가" 는 원장 합계가 답 |

---

## 2. DB — `supabase/storage/001_storage.sql`

### 2-1. `ft_order_items.arrival_route`
```sql
ALTER TABLE public.ft_order_items
  ADD COLUMN IF NOT EXISTS arrival_route text NOT NULL DEFAULT 'SHIPMENT'
  CHECK (arrival_route IN ('SHIPMENT','STOCK'));
CREATE INDEX IF NOT EXISTS ft_order_items_route_stock_idx
  ON public.ft_order_items (user_id) WHERE arrival_route = 'STOCK';
```
- DEFAULT 가 있는 컬럼 추가는 PG11+ 에서 메타데이터만 바꿈 → 40,913행 즉시, 잠금 짧음. 기존 행 전부 SHIPMENT.
- `ft_cart_items` 에도 같은 컬럼 (purchase-agent 장바구니 → 주문 전환 시 복사).

### 2-2. 위치 `ft_storage_locations`
```
id uuid PK, code text NOT NULL UNIQUE, name text, zone text, sort int, active bool DEFAULT true,
created_at, created_by text
```
- 창고 공용(사업자 무관). `code` 는 스캔 값 그대로(trim·대문자). 첫 PUTAWAY 때 없으면 자동 INSERT.

### 2-3. 원장 `ft_storage_movements` (append-only, 재고의 단일 진실)
```
id uuid PK, created_at, user_id uuid NOT NULL, product_id uuid NOT NULL, order_item_id uuid NOT NULL,
inbound_id uuid           -- PUTAWAY: 어느 입고 건에서 왔나 (미배치 계산용). FK 없음(입고 철회 이력 보존, 이동요청 테이블과 같은 이유)
location_id uuid NOT NULL REFERENCES ft_storage_locations(id),
kind text NOT NULL CHECK (kind IN ('PUTAWAY','PICK','MOVE_OUT','MOVE_IN','ADJUST')),
quantity int NOT NULL CHECK (quantity > 0),   -- 부호는 kind 가 정한다 (PUTAWAY/MOVE_IN +, PICK/MOVE_OUT −, ADJUST 는 note 의 부호)
delta int NOT NULL,                            -- 합계용 서명값 (+/−), 함수가 채운다
outbound_id uuid,                              -- PICK: 만들어진 PACKED 행
move_group_id uuid,                            -- MOVE_OUT/MOVE_IN 짝
operator_name text, note text
```
- 인덱스: `(user_id, product_id, location_id)`, `(inbound_id) WHERE kind='PUTAWAY'`, `(outbound_id) WHERE outbound_id IS NOT NULL`.
- RLS 끔 + anon SELECT 만 (다른 ft_* 와 동일, 고객 화면 후속 대비). 쓰기는 함수로만 (REVOKE INSERT/UPDATE/DELETE FROM anon, authenticated).

### 2-4. 뷰 `ft_storage_balance` — 위치별 재고
```
user_id, product_id, location_id, qty = SUM(delta)   HAVING SUM(delta) <> 0
```
(0 이 된 칸은 사라지고, 음수는 그대로 노출 — 운영 이상 신호)

### 2-5. 함수 (service role 전용, `ft_shipment_manual_create` 와 같은 틀)

**`ft_storage_putaway(p_user_id, p_inbound_id, p_location_code, p_qty, p_operator_name) → jsonb`**
1. 입고 행 `FOR SHARE`: 존재 / type=ARRIVAL / 같은 user / 주문 행 `arrival_route='STOCK'` → 아니면 `PUTAWAY_NOT_STOCK`
2. `pg_advisory_xact_lock(hashtext(p_inbound_id::text))` → 미배치 = `quantity − Σ PUTAWAY(inbound_id)`; `1 ≤ p_qty ≤ 미배치` 아니면 `PUTAWAY_INVALID_QTY`
3. 위치 `upper(trim(code))` 로 조회, 없으면 INSERT(created_by = operator)
4. INSERT movement PUTAWAY (+p_qty)
5. 반환 `{ location_id, location_code, remaining }`

**`ft_storage_pick_to_shipment(p_user_id, p_product_id, p_order_item_id, p_picks jsonb[{location_id, qty}], p_box_info_id, p_operator_name) → jsonb`**
1. `pg_advisory_xact_lock(hashtext(p_product_id::text))`
2. 주문 행 검증(같은 user·STOCK·DONE 아님) / 박스 `FOR SHARE`(같은 user·`shipment_id IS NULL`·PACKING — `ft_move_outbound` 기준) → `PICK_BOX_NOT_OPEN`
3. **박스 타입 검증**: `ft_box_effective_type(box)` 와 주문의 사이즈 코드(`shipment_type`+`coupang_shipment_size` → A/B/C/P/X, SQL 로 옮긴 `resolveScanSizeCode`) 비교. 다르면 `PICK_BOX_TYPE_MISMATCH` (예외 문구에 두 타입 포함). `p_force=true` 로 허용 모드(상품출고 V2 "A=B=C=P=X" 와 동일 의미) 지원
4. 각 pick: 그 위치 잔량(`SUM(delta)`) ≥ qty 아니면 `PICK_INVALID_QTY`
5. INSERT `ft_fulfillment_outbounds` 1행 (order_item_id, PACKED, quantity=Σqty, box_code, box_info_id, product_no, product_id, order_no, operator_name, user_id, note=`'STOCK ' || 위치코드 목록`) — **상품출고 V2 가 만드는 행과 같은 모양**
6. INSERT movement PICK (−qty) 위치마다, `outbound_id` = 5 의 id
7. 반환 `{ outbound_id, box_code, picked }`

**`ft_storage_move(p_user_id, p_product_id, p_from_location_id, p_to_location_code, p_qty, p_operator_name)`** — 위치 이동 (MOVE_OUT/MOVE_IN 짝, `move_group_id`). 1차 범위에 포함(작업자가 잘못 넣은 경우 바로 필요).

ADJUST 는 함수 없이 **1차 범위 제외** (§6 결정 6).

### 2-6. 기존 동작과의 상호작용 (논리 모순 점검)

| 상황 | 결과 |
|---|---|
| 재고에서 담은 PACKED 행을 쉽먼트 V2 에서 [이동]/[합배송]/분할 이동 | 일반 행과 동일. PICK 은 "선반에서 나갔다" 는 사실이라 어느 박스로 가든 불변 |
| 재고에서 담은 행을 **포장 철회**(DELETE outbound) | 물건이 선반으로 돌아가야 한다 → `DELETE /api/ft/fulfillments` 에 분기: `ft_storage_movements.outbound_id = id` 인 PICK 이 있으면 **같은 위치에 PUTAWAY(note='unpack')** 로 되돌린다 (이동요청 CANCELLED 처리와 같은 자리, 같은 "삭제 후 보정" 방식). 분할 이동으로 생긴 새 행(outbound_id 링크 없음)을 철회하면 복귀 못 함 → 철회 응답에 "재고 복귀 안 됨, [재고]에서 위치 이동/조정 필요" 경고. 운영상 드문 경로(분할 후 철회) |
| **입고 철회**(ARRIVAL DELETE) 뒤 | PUTAWAY 는 남는다(FK 없음). 미배치 계산은 입고 행이 없어져 그 줄이 사라지고, 재고는 그대로 → 물리 현실(이미 선반에 있음)과 일치. 입고 철회 시 PUTAWAY 가 있으면 **409 거절** ("이미 위치에 배치된 입고 건은 철회할 수 없습니다. 재고에서 먼저 빼 주세요") — §6 결정 5 |
| 반품접수 V2(RETURN) 보관 상품 | RETURN 은 inbounds 행이라 원장에 안 잡힘 → 반품 접수 화면에서 보관 상품이면 안내만 ("재고 위치에서 수량을 빼 주세요") — 1차는 수동. ADJUST 도입 시 자동화(§6-6) |
| 타입 A → 보관 토글 ON (이미 박스에 담긴 뒤) | 입고 건은 PACKED 로 소진됐지만 미배치 공식은 `ARRIVAL − PUTAWAY` 라 [작업중]에 나타난다 → 미배치 공식을 **`ARRIVAL − PUTAWAY − (이 order_item 의 PACKED 중 원장 PICK 과 연결되지 않은 수량)`** 로 둔다. 즉 일반 경로로 이미 포장된 수량은 배치 대상 아님 |
| 보관 토글 OFF (선반에 있는 채로) | 상품출고 V2 목록에 나타나 스캔 가능 → PACKED 생기지만 원장 PICK 없음 → 재고가 남아 보임. **토글 OFF 는 재고 잔량 0 일 때만 허용**(API 에서 검사, 409) |
| 고객 이동요청 | 박스 타입 기준 — 무관 |
| confirmDone·쉽먼트 V2 에러 판정·카드보드·통관 엑셀·처리속도·물량관리 | `shipment_type` 불변이라 **전부 변경 없음** |
| 부자재(`manual_item_id`) | order_item 이 없으므로 대상 아님 |

---

## 3. 1688-invoice

### 3-1. 공통
| 파일 | 변경 |
|---|---|
| `lib/ftOrderItemsSelect.ts`, `useFtData.ts FtOrderItem` | `arrival_route` 컬럼 추가 |
| `lib/sizeCode.ts` | **변경 없음**. 배지 옆 S 칩은 새 헬퍼 `isStockRoute(item)` 한 줄 + `component/StockChip.tsx`(노랑 `#eab308`/글자 `#1f2937`, globals.css `.route-chip--stock`) |
| `app/order-status-v2` | 타입 셀에 S 칩. `TypeChangePopup` 에 구분선 + **"보관" 토글**(현재값 표시) → `PATCH /api/ft/order-items { arrival_route }`. OFF 는 서버가 재고 잔량 검사(§2-6) |
| `app/order-status-v2/utils/deliveryAlerts.ts` + `AlertCriteriaPopover` | `arrivalRoute` 입력 추가. STOCK 이고 `packedQty < target` 이면 포장 지연 판정 **제외**; 포장이 시작된 뒤 출고 지연은 그대로. 문구 한 줄 추가 (purchase-agent 와 동일 유지) |
| `app/import-product-v2/components/ItemTableRow.tsx`, V3 `OrderRowTable` | 배지 옆 S 칩 (입고 작업자가 "이건 보관" 을 입고 시점에 보게) |
| `app/export-product-v2/ExportProduct.tsx` | `fetchExportData` 에서 `arrival_route==='STOCK'` **제외** → 스캔하면 기존 "주문번호 없음" 경로. 안내 문구만 "보관 상품은 [재고] 메뉴에서 쉽먼트로 보내주세요" 로 구체화 |
| `app/api/ft/order-items` PATCH | `arrival_route` 허용 + OFF 검사 |
| `app/api/ft/fulfillments` DELETE | §2-6 두 분기 (입고 철회 409 / 포장 철회 PUTAWAY 복귀) |
| `app/db/database/pageTableMap.ts`, `locales/ko.json`·`zh.json` (`storage.*`) | 등록 |

### 3-2. 페이지 `/storage` — 좌측 메뉴 "재고(보관)" 드롭다운 (상품출고 아래)
```
app/storage/
  layout.tsx                    — 사용자 선택 공유(헤더) + 탭 [작업중] [재고]
  pending/page.tsx → Pending.tsx + Pending.css        — [작업중]
  stock/page.tsx   → Stock.tsx   + Stock.css          — [재고]
  components/
    ScanBar.tsx                 — 상단 입력창 1개 (autofocus, Enter 확정, 오류음 = export-v2 playErrorSound 재사용)
    PutawayModal.tsx            — 사진 · 상품명/옵션 · 중국어옵션(china_option1·2) · 미배치 수량 · 추천 위치 칩 · 위치 입력(Enter) · 수량(기본 = 미배치 전량) · [저장]
    PendingTable.tsx            — 입고 건 단위 행: 입고일·담당자·사진·상품·옵션·중국어옵션·입고수량·배치됨·미배치·[배치]
    StockTable.tsx              — product×location 행: 위치·사진·상품·옵션·중국어옵션·수량·최근 입고·보관일수·체크
    StockDetailModal.tsx        — 주문 당시 정보 + 원장 타임라인(PUTAWAY/PICK/MOVE)
    PickToShipmentModal.tsx     — 체크 행별 수량 + 박스 선택/생성(BoxCreateModal) + 담당자(useWorkers) + 타입 불일치 경고/허용 체크
    MoveModal.tsx               — 위치 이동
  hooks/usePendingRows.ts, useStockRows.ts, useLocationSuggest.ts
  types.ts
```
- **[작업중] 흐름**: 상단 ScanBar 에 주문번호 라벨 스캔 → `product_no` 정규화 → 그 상품의 미배치 입고 건 중 **가장 오래된 1건** 선택(여러 건이면 모달 상단에 건 선택 칩) → PutawayModal. 위치 입력창에 스캔(Enter) → 수량 입력창으로 포커스(기본값 미배치 전량) → Enter 또는 [저장] → `POST /api/ft/storage/putaway` → 성공 시 모달 유지·잔량 갱신(분리 보관), 잔량 0 이면 닫고 ScanBar 로 포커스. 표의 [배치] 버튼도 같은 모달.
- 추천 위치 칩: `GET /api/ft/storage/suggest?user_id&barcode&offer_id` → ① 같은 barcode 보관 위치(수량 표시) ② 같은 `1688_offer_id` ③ 없음. 칩 클릭 = 위치 입력 채움.
- **[재고] 흐름**: 기본 필터 `qty > 0`, 검색(상품·옵션·바코드·주문번호·위치). 체크 → [쉽먼트] → PickToShipmentModal (같은 상품이 여러 위치면 위치별 수량 입력) → 행마다 `POST /api/ft/storage/pick` → `SaveResultModal` 요약. [이동] → MoveModal. 행 클릭 → 상세(타임라인).
- 헤더 카드: `[작업중 n건 · 미배치 n개] [재고 n위치 · n개] [30일 이상 n]`.

### 3-3. API `app/api/ft/storage/`
| 라우트 | 동작 |
|---|---|
| `GET pending?user_id=` | STOCK 주문의 ARRIVAL 행(`fetchAll`) + 해당 inbound_id 의 PUTAWAY 합(`batchIn`) + order_item 의 PACKED 중 미연결 수량 → 미배치 > 0 행. 응답에 사진·옵션·중국어옵션 포함 |
| `GET stock?user_id=` | `ft_storage_balance`(user eq) + `ft_order_items` 대표행(product_id → item_no 최소) + 위치 코드 조인 |
| `GET ledger?user_id&product_id` | `ft_storage_movements` 시간순 |
| `GET suggest?user_id&barcode&offer_id` | §3-2 규칙 |
| `POST putaway` / `POST pick` / `POST move` | 각 rpc. 예외 `PUTAWAY_*`/`PICK_*` 를 한글로 변환(`/api/ft/shipment-v2/move` 방식) |
| `GET locations` | 위치 목록(코드·이름·구역·사용 중 수량) — 1차는 조회만, 편집은 후속 |

---

## 4. purchase-agent (고객 쪽) — 최소 변경
| 파일 | 변경 |
|---|---|
| `app/progress/cart/lib/cartColumns.ts`, `InfoFillDropdown.tsx` | 열 `보관` (select `SHIPMENT/STOCK`, 기본 SHIPMENT) — 쉽먼트타입 3종은 그대로 |
| 장바구니 → 주문 전환 | `arrival_route` 복사 (현재 전환 코드가 `...item` 스프레드면 자동, 아니면 컬럼 목록에 추가) |
| `lib/sizeCode.ts` | 변경 없음 + 1688 과 같은 S 칩 |
| `app/progress/orders/components/TypeChangePopup.tsx`, `ItemsTableView` | "보관" 토글 (OFF 는 1688 과 같은 잔량 검사 — anon 이 직접 UPDATE 하므로 **DB 트리거** `ft_order_items_route_guard` 로 막는다: STOCK→SHIPMENT 변경 시 `ft_storage_balance` 잔량 > 0 이면 RAISE) |
| `lib/deliveryAlerts.ts` + `AlertFilterButton.tsx` | 1688 과 동일한 STOCK 제외·문구 |
| `app/inventory/page.tsx` (+ `services/storageService.ts`, `hooks/useStorageData.ts`, `components/Storage*.tsx`) | **재고관리 화면 (구현 완료 2026-11-02)** — [작업중]·[재고]·[이력] 읽기 전용. 창고와 같은 뷰·원장·함수(`ft_storage_pending_lines` anon EXECUTE — `supabase/storage/002_storage_anon_read.sql`)를 읽으므로 숫자가 같다 |
| (후속) 고객이 재고에서 쉽먼트 요청 | §7 — 요청 테이블이 없어 현재는 창고에 구두로 요청 |

> 트리거는 1688 쪽 PATCH 검사와 중복되지만, 고객 화면이 anon 으로 직접 UPDATE 하는 경로가 있어 **DB 가 최종 방어선**이어야 한다 (`ft_cancel_details_settled_guard` 선례).

---

## 5. 작업 순서 (커밋 단위)

| # | 저장소 | 내용 | 의존 |
|---|---|---|---|
| 1 | DB | `supabase/storage/001_storage.sql` — 컬럼·테이블 2·뷰·함수 3·트리거·권한. 롤백 블록 검증(다른 팀·STOCK 아님·초과 수량·위치 자동 등록·분리 배치·타입 불일치·허용 모드·동시 클릭) | — |
| 2 | 1688-invoice | §3-1 공통 (컬럼 select·S 칩·토글·확인필요 제외·상품출고 목록 제외·PATCH·DELETE 분기·i18n) | 1 |
| 3 | 1688-invoice | `/api/ft/storage/*` | 1 |
| 4 | 1688-invoice | `/storage` [작업중]·[재고] + 메뉴 + pageTableMap | 3 |
| 5 | purchase-agent | §4 (`main`) | 1, 2 와 같은 날 배포 |
| 6 | 양쪽 | `npm run type-check`(1688) / `tsc --noEmit && build`(purchase-agent) | 전체 |

검증 (운영 DB, 테스트 사용자 BR — 끝나고 id 로 정리)
- BR 주문 1건 보관 토글 ON → 주문상태 V2·입고 V2 에 `[A][S]`, 확인필요 미발생, 상품출고 V2 목록에 없음·스캔 시 안내.
- 입고 V2 ARRIVAL 5 → [작업중] 1줄 미배치 5. 라벨 스캔 → 모달(사진·옵션·중국어옵션·5) → 위치 `T-01` 스캔 → 3 저장 → 잔량 2 유지 → `T-02` 에 2 → 줄 사라짐. 위치 2개 자동 등록 확인. 두 번째 입고 뒤 추천 칩에 `T-01(3)`·`T-02(2)` 표시.
- [재고] 2줄 → 체크 → [쉽먼트] 위치별 수량(T-01 3) → 임시 박스 `BR-X-99`(타입 불일치면 경고, 허용 체크로 통과) → 쉽먼트 V2 에 PACKED 행, 재고 T-01 사라짐, 타임라인 PICK. 포장 철회 → T-01 에 PUTAWAY(unpack) 복귀. 입고 철회 시도 → 409.
- 초과 수량·닫힌 박스·동시 두 창 클릭 → 각각 한글 안내·한쪽만 성공.

---

## 6. 결정 사항

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 데이터 모델 | **별도 컬럼 `arrival_route`** (shipment_type 불변) — 2차 검토 | 두 축은 독립된 사실. 1차 안(STOCK 값)은 포장 타입을 잃어 예외가 퍼짐 |
| 2 | 재고 저장 방식 | **전용 원장 `ft_storage_movements`** (1차 안의 파생 뷰 폐기) | 위치는 기존 행 어디에도 없는 새 정보 — 파생 불가 |
| 3 | 위치 코드 | 자유 형식, 첫 스캔 때 자동 등록, USB 리더 Enter 확정 | 사용자 답변. 라벨 출력·편집 화면은 후속 |
| 4 | 추천 위치 | 같은 바코드 → 같은 offer_id → 없음 | 사용자 답변 |
| 5 | 입고 철회 vs 이미 배치 | **409 거절** | 선반에 있는 물건의 입고 기록을 지우면 원장과 현실이 어긋남. 빼고 나서 철회 |
| 6 | 조정(ADJUST)·반품 자동 차감·위치 편집·라벨 출력 | **1차 제외** | 핵심 흐름(배치→보관→쉽먼트) 먼저. 반품은 안내 문구로 수동 |
| 7 | 작업중 단위 / 스캔 키 | 입고 건 단위 / 주문번호 라벨만 | 사용자 답변 |
| 8 | 경로·메뉴명·색 | `/storage`, "재고(보관)", S 칩 노랑 `#eab308` | 로켓 재고(`stock_management`)와 이름 충돌 회피, P 주황과 구분 |
| 9 | 세트상품 수량 단위 (구현 중 발견) | 원장·미배치 모두 **상품(product_id) 단위, 1세트 = 1**. 미배치 = MIN over sibling(ARRIVAL−RETURN) − PUTAWAY − 미연결 PACKED. [작업중] 한 줄 = "완성 세트 수를 늘린 입고 건"(단품이면 입고 건 그대로), 미배치는 오래된 줄부터 FIFO | ARRIVAL 은 구성품마다, PACKED 는 상품당 1번 기록된다(세트 8,061개 · 진행 행 1,442). 입고 건 단위 배치는 세트를 구성품 수만큼 중복 집계 |
| 10 | 미배치 계산 위치 | DB 함수 `ft_storage_pending_lines` 한 곳 — [작업중] API 와 `ft_storage_putaway` 검증이 같은 함수를 쓴다. 배치 모달은 상품 단위(줄 선택 칩 없음) | 공식이 두 곳에 있으면 어긋난다. FIFO 라 줄 선택은 의미가 없음 |
| 11 | 포장 철회 복귀 | 원장 kind `UNPACK` 추가 (PUTAWAY note='unpack' 대신). `ft_storage_unpick_outbound` 가 행 삭제 + 위치 복귀를 한 트랜잭션으로. 링크 없는 분할 행 철회는 경고 대신 **[작업중]에 자동으로 다시 나타남**(미연결 PACKED 가 음수가 되어 미배치 증가) | 배치(입고분)와 복귀를 구분해야 미배치 공식이 맞다. 선반 밖에 나온 물건은 실제로 다시 배치가 필요 |
| 12 | 보관 토글 API | 일반 `PATCH /api/ft/order-items` 는 arrival_route 거부 → 전용 `PATCH /api/ft/order-items/arrival-route` 가 같은 product_id 전체를 바꾼다 | 세트 구성품끼리 경로가 다르면 원장 단위가 깨진다 |
| 13 | 장바구니 → 주문 전환 | 실제 전환은 auto-1688-order 프로그램(`renderer.js`)이 한다 → v1.0.91 에서 `arrival_route` 복사(세트는 하나라도 보관이면 전체 보관) | 계획서 §4 의 "전환 코드" 가정과 달랐음 |

## 7. 범위 밖 (별도 작업 후보)
- ~~고객이 재고에서 쉽먼트 요청~~ → **구현 완료 (2026-11-02, `supabase/storage/003_stock_type.sql`)**. S 타입 계획(`D:\project\purchase-agent\docs\PLAN_stock-type-S.md`)과 함께: 박스 타입은 꺼낼 때 정하고(`ft_storage_resolve_type`), 고객 요청 `ft_storage_requests` 를 창고 [재고]·담기 모달이 보여준다.
- ~~ADJUST(실사 조정)~~ → **구현 완료 (2026-11-02, `supabase/storage/004_storage_adjust.sql`)**. 창고 [재고] 칸 하나 체크 → [수량 수정] → 새 수량 + 사유 → 원장 ADJUST 기록. (반품은 배치 전에 처리되는 운영 흐름이라 자동 차감은 두지 않음 — 사용자 확인)
- ADJUST 함수 + 반품접수 연동 + 재고 실사.
- 위치 관리 화면(이름·구역·비활성) + 위치 바코드 라벨 출력(`lib/labelRender` 재사용).
- `POST /api/ft/shipments` 의 `ft_box_info.shipment_id` box_code 갱신 결함(이전 계획 §6) — 이번 기능 영향 없음.
