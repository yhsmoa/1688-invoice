# 작업 계획 — ① 물량관리 '처리속도' 탭 / ② 쉽먼트 V2 '이동' 부분 수량 이동 / ③ 배송완료 이력 축적

작성일: 2026-09-28 · 상태: **구현 완료 (2026-09-28)** — 계획과 달라진 점은 맨 아래 "5. 구현 결과" 참조
대상 페이지: `/db/volume`, `/shipment-v2`

---

## 0. 조사 요약 (Supabase 실측, 2026-09-28 기준)

| 테이블 | 건수 | 비고 |
|---|---|---|
| `ft_order_items` | 29,344 | `shipment_type` + `coupang_shipment_size` 로 A/B/C/P/X 판정 |
| `ft_fulfillment_inbounds` | 30,564 | ARRIVAL / CANCEL / RETURN, `created_at` = 스캔 시각 |
| `ft_fulfillment_outbounds` | 20,328 | PACKED, `created_at` = 포장 스캔 시각. 미출고(PACKED & shipment_id NULL) **1,037** |
| `ft_shipments` | 144 | `date`(date형, 출고일) |
| `ft_shipment_details` | 18,796 | 확정 스냅샷. `fulfillment_id` → outbound `id` (18,788건 일치) |
| `ft_box_info` | 1,266 | 박스. `status='PACKING'`, `shipment_id NULL` 이 "열린 박스" |
| `im_1688_orders_delivery_status` | 1,313 | **CSV 업로드 시 전체 삭제 후 재삽입되는 스냅샷** (이력 없음, 중복 주문 0, 배송완료 1,206, `status_since` 최초 2026-09-22) |

모두 1000행 초과 → 모든 조회는 `range()` 페이지네이션 또는 SQL 함수(rpc) 집계 필수.

---

# Part 1. 물량관리 — '처리속도' 탭

## 1-1. 현황

- `app/db/volume/VolumeManage.tsx` 단일 컴포넌트(341행)가 주간/월간 물량·근무시간·시간당 처리량을 표시. 데이터는 `GET /api/db/volume-weekly` (`guardDbRoute` 로 접근 제한).
- 기간 버킷 helper 는 `lib/periodBucket.ts` (`periodStartOf / periodEndOf / toKstDate`) — 재사용.
- 사이드메뉴: `component/LeftsideMenu.tsx:306` DB 관리 > 물량관리. 별도 메뉴 추가 없이 **같은 페이지 안에 탭**으로 구현 가능 (`/db/volume?tab=speed` 로 딥링크만 지원).

## 1-2. 단계(stage) 정의

"하나의 제품" = `ft_order_items` 1행(주문 항목). 각 단계는 **완료 이벤트 시각 − 직전 단계 완료 시각**, 단위는 **일(소수 1자리)**. 버킷(주/월)은 **해당 단계가 완료된 날짜(KST)** 기준 — 기존 물량 탭이 이벤트 발생일로 세는 것과 동일한 관점.

| 단계 | 시작 | 종료 | 데이터 소스 | 커버리지 |
|---|---|---|---|---|
| 배송 | 1688 주문일시 `ordered_at` | 배송완료 추정 시각 `delivered_at` (Part 3 이력 테이블) | `im_1688_delivery_history` ↔ `ft_order_items."1688_order_id"` | 이력 시작(2026-09-22) 이후 주문부터 누적. 과거 주차는 빈칸 |
| 입고 | 배송완료 `delivered_at` | 첫 ARRIVAL `created_at` (항목당 ARRIVAL 평균 1.01행) | inbounds + 이력 테이블 | 배송 단계와 같은 범위. 업로드 지연으로 ARRIVAL 이 `delivered_at` 보다 앞설 수 있음 → Part 3-5 규칙으로 보정 |
| 포장 | 해당 PACKED 이전의 **마지막 ARRIVAL** `created_at` — 세트(`set_total > 1`)는 같은 `product_id` 형제 항목의 ARRIVAL 까지 포함(세트는 전부 도착해야 포장 가능, `confirmDone` 의 product_id 기준과 일치) | PACKED `created_at` (PACKED 행 단위, 항목당 평균 1.07행, 1,175항목이 다회 포장) | inbounds + outbounds | 전체 (ARRIVAL 없이 PACKED 된 행 0건 확인) |
| 출고 | PACKED `created_at` | `ft_shipments.created_at` (출고 버튼 클릭 시각, 기본) 또는 `ft_shipment_details.confirmed_at` (기준일 토글) | outbounds.shipment_id → shipments | 전체. 144건 모두 `created_at` KST 날짜 = `date` 확인 → 기존 탭의 `date` 기준과 일관되며 시각 정밀도만 높음 |

공통: 음수 duration(시각 역전)은 제외하고 `n_skipped` 로 응답(현재 데이터엔 포장 > 출고 역전 0건). 조인 키 `"1688_order_id"` 는 `trim` 후 비교(현재 공백 오염 0건이지만 방어).

**배송·입고 단계는 스냅샷이 아니라 Part 3 의 이력 테이블을 읽는다**
- `im_1688_orders_delivery_status` 는 업로드마다 전체 삭제되는 스냅샷이고, 배송완료 주문은 1688 에서 수령확인 후 목록(待收货 탭)에서 사라지므로 스냅샷만으로는 이력이 남지 않는다.
- 따라서 Part 3 을 **먼저** 구현해 이력을 쌓기 시작하고, 처리속도 탭의 배송·입고 열은 이력 테이블을 조인한다. 이력이 없는 주문(2026-09-22 이전 완료분)은 표본에서 제외되고 화면에 "표본 n" 으로 드러난다.

**세트 / 단품 구분 (전체 · 세트 · 단품)**
- 판정: `ft_order_items.set_total > 1` → 세트, 그 외(1 또는 NULL) → 단품. 실측 항목 11,403 세트 / 17,941 단품, 세트인데 `product_id` 없는 행 0건.
- 집계 단위가 단계마다 다르다는 점을 화면 안내문에 명시한다.
  - 배송·입고: **항목(부품) 단위** — 세트의 각 부품이 다른 1688 주문에서 따로 오므로 부품마다 자기 배송·입고 시간을 가진다.
  - 포장·출고: **PACKED 행 단위** — 세트는 대표 항목 1행으로 포장되므로 세트 1개 = 1건. 따라서 세트의 배송·입고 n 과 포장·출고 n 은 다르다(부품 수 배).
- SQL 함수 그룹 키에 `is_set boolean` 추가, TS 매핑에서 `ALL = 세트 + 단품` 합산(가중 평균).

**A/B/C/P/X 판정**
- `lib/sizeCode.ts`의 `resolveScanSizeCode(shipment_type, coupang_shipment_size)` — export-product-v2 스캔 검증과 동일 기준(단일 소스). 실측 분포: PERSONAL 13.7k(P), COUPANG SMALL 12.2k(A), DIRECT 3.1k(X), MEDIUM 117(B), LARGE 63(C). 오염값(`P-`, `○○ - 재주문`)은 함수가 X 로 폴백.
- ※ shipment-v2 배지는 `ft_cp_shipment_size` 레거시 경로를 쓰고 있어 기준이 다름 — 이번 범위에서 수정하지 않고 기록만 함.

## 1-3. 구현 방식 — SQL 함수(rpc) 집계 (권장)

배송 탭 방식(전 테이블 fetchAll)으로 하면 요청당 약 8만 행/80회 왕복이 필요해 부적절. 이미 프로젝트는 `supabase.rpc()` 를 사용 중(`lib/userTransactions.ts:294`, public 함수 14개)이고 SQL 파일은 `supabase/<domain>/NNN_*.sql` 규칙으로 보관 중.

1. **`supabase/db/001_process_speed.sql`** — `db_process_speed(p_period text, p_basis text)` 함수
   - 반환: `(period_start date, shipment_type text, coupang_shipment_size text, is_set boolean, stage text, sum_days numeric, n int, n_skipped int)`
   - 단계별 CTE 로 행 단위 duration 계산 후 `date_trunc('week'|'month', 완료시각 AT TIME ZONE 'Asia/Seoul')` 로 그룹. 주 시작은 월요일(`date_trunc('week')` 기본이 월요일) → `lib/periodBucket.ts` 와 일치.
   - 배송·입고 CTE 는 `im_1688_delivery_history` 를 `ft_order_items."1688_order_id"` 로 조인 (Part 3-5 의 추정·보정 규칙 적용).
   - 사이즈 코드 판정은 SQL 에 복제하지 **않는다**(로직 이원화 방지). raw `(shipment_type, coupang_shipment_size)` 조합으로만 그룹해 TS 에서 `resolveScanSizeCode` 로 접어 합산(가중 평균 = Σsum/Σn). 결과는 수백 행 규모.
   - 음수 duration(시각 역전) 은 제외하고 별도 `n_skipped` 로 반환.
2. **`app/api/db/process-speed/route.ts`** — `GET ?period=week|month&basis=shipment|confirmed`
   - `guardDbRoute` 적용, `parsePeriod` 재사용, rpc 호출 → 사이즈 코드 매핑 → `{ periods: [{ periodStart, periodEnd, cells: { [setKind: 'ALL'|'SET'|'SINGLE']: { [size: 'ALL'|'A'|'B'|'C'|'P'|'X']: { delivery|arrival|packing|outbound: { avgDays, n } } } } }], meta }`. 두 축(세트구분 × 사이즈)의 `ALL` 은 서버에서 Σsum/Σn 으로 미리 접어 프론트는 선택만 한다.
3. **프론트 구조 분리** (CLAUDE.md 규칙 2)
   - `app/db/volume/VolumeManage.tsx` → 탭 셸(헤더 + 탭 버튼 + `?tab=` 동기화)만 남김
   - `app/db/volume/components/ThroughputTab.tsx` — 현재 내용 이동(로직 변경 없음)
   - `app/db/volume/components/ProcessSpeedTab.tsx` + `hooks/useProcessSpeed.ts`
   - CSS: `VolumeManage.css` 에 탭 섹션 추가(`/* ==== */` 구획), 기존 `.vm-basis-btn` 스타일 재사용
4. **화면**
   - 컨트롤: 단위(주간/월간) · 기준일(출고일/확정일) · **구분(전체/세트/단품)** · **사이즈(전체/A/B/C/P/X)** — 모두 기존 `.vm-basis-btn` 토글 스타일
   - 표: 행 = 기간, 열 = `배송 | 입고 | 포장 | 출고 | 합계(주문→출고)`. 셀 = `3.2일` + 작은 글씨 `n=120`. 표본 0 은 `—`.
   - 요약 카드: 선택 사이즈의 전체 기간 평균 4개.
   - 하단 안내문: 각 단계 정의 + 배송/입고 커버리지 한계 + 세트의 단계별 집계 단위 차이(부품 vs 세트) 명시.

## 1-4. 검증

- SQL 함수: 임의 항목 3~5건을 골라 수작업 계산과 대조(주차 경계·KST 변환 포함). 세트 1건은 반드시 포함 — 포장 시작 시각이 형제 부품 중 마지막 ARRIVAL 인지, 세트 n 이 포장·출고에서 1로 세어지는지 확인.
- 전체 = 세트 + 단품 합산 검증: 각 셀에서 `n(전체) = n(세트) + n(단품)`, `avg(전체) = (sum세트 + sum단품) / n(전체)`.
- `npm run type-check`.
- 기존 물량 탭이 이동 후에도 동일 결과인지 화면 비교.

---

# Part 2. 쉽먼트 V2 — '이동' 부분 수량 이동

## 2-1. 현황 (문제 정리)

- `app/shipment-v2/ShipmentV2.tsx:375-414` `handleMoveConfirm` — 체크된 행의 `box_code` 만 문자열 교체(`PATCH /api/ft/shipment-v2`). `box_info_id` 는 갱신하지 않음 → 이동 후 `ft_box_info` 삭제 가드(`box-info/route.ts:155-176`)가 옛 박스를 계속 "상품 있음" 으로 판단하는 잠재 버그.
- 모달(`:847-880`) 이 select 와 text input 을 **같은 state 에 동시에 바인딩** → 사용자가 이상하게 느낀 원인. 자유 입력이라 `ft_box_info` 에 없는 박스코드도 들어갈 수 있음(현재 데이터는 0건이지만 구조적 허용).
- 수량 분할 불가.

## 2-2. DB 검증 결과 (분할이 안전한 근거)

- 미출고 PACKED 1,037행: `box_info_id` NULL 0, 댕글링 0, 열린 박스 없는 box_code 0, qty≤0 0. 같은 (항목, 박스) 중복 행 2건 존재 → **한 항목이 한 박스에 여러 행으로 있는 것은 이미 허용된 모델**.
- `ft_shipment_details.fulfillment_id` 는 **확정 시점**에 outbound id 를 복사 → 미출고 행을 쪼개 새 id 가 생겨도 영향 없음.
- 수량 합산 소비자(`total_qty`, `available_qty`, `lib/confirmDone.ts`, `deliveryAlerts.ts` packedQty) 는 모두 `SUM(quantity)` → 분할 전후 합 불변.
- `deliveryAlerts.ts` `lastPackedAt` = PACKED `created_at` 최대값 → 분할 행의 `created_at` 을 **원본에서 복사**하면 "포장 시각" 의미가 유지되고 확인필요 판정·Part 1 처리속도 통계도 왜곡되지 않음.
- `ft_box_info.user_id + box_code(shipment_id NULL)` 중복 0 → 열린 박스는 코드로 유일. 단, 출고 후 코드 재사용(예: MB-A-01) 이 있으므로 **대상은 반드시 `ft_box_info.id` 로 지정**.

## 2-3. 설계

### 모달 (단건 / 다건)

| 필드 | 단건 선택 | 다건 선택 |
|---|---|---|
| 이동할 주문번호 | `product_no` (읽기 전용) + 상품명 한 줄 | `"{첫 product_no} 외 {N-1}건"` |
| 이동할 박스 | 드롭다운: 해당 유저의 열린 박스(`GET /api/ft/box-info?user_id&status=PACKING&shipment_id=null`, 합배송 모달과 같은 소스). 현재 박스는 목록에서 제외/비활성 | 동일 (선택 행들의 박스 전부 제외) |
| 이동할 수량 | number, 기본값 = 행 `quantity`, 1 ≤ qty ≤ `quantity`. qty = quantity 이면 전체 이동 | **비활성** + "전체 이동" 안내 |

- 자유 입력 제거(존재하는 박스만). 새 박스가 필요하면 export-product-v2 에서 생성하는 기존 흐름 유지.
- 박스 타입(`BZ-A-01` → A) 과 행 `shipment_size` 가 다르면 확인 `confirm` 만 띄우고 진행 허용 → **[결정 B]** (export-product-v2 는 차단, 이동은 관리자 작업이라 경고만 제안).
- 모달 텍스트는 현재 하드코딩 → `locales/ko.json` + `zh.json` 의 `shipmentV2.modal.*` 에 키 추가(둘 다 동기화).
- 구조: `app/shipment-v2/components/MoveModal.tsx` 로 분리(ShipmentV2.tsx 994행). 스타일은 `ShipmentV2.css` 이동 모달 구획에 추가.

### API — `POST /api/ft/shipment-v2/move`

```
Body: { user_id, target_box_info_id, moves: [{ id, quantity? }] }
```
서버 검증 순서:
1. 대상 박스 조회: `ft_box_info.id = target`, `user_id` 일치, `shipment_id IS NULL`, `status='PACKING'` 아니면 409.
2. 원본 행 일괄 조회(`ft_fulfillment_outbounds` id IN …): `type='PACKED'`, `shipment_id IS NULL`, `user_id` 일치, 이미 대상 박스인 행 → 스킵 목록.
3. 행별 처리 — **전체/분할 판정은 클라이언트 값이 아니라 2단계에서 읽은 DB 수량 기준**
   - ⚠️ 화면의 '스캔' 셀 인라인 편집(`handleQuantityBlur`)은 로컬 state 만 바꾸고 저장하지 않는다(기존 동작). 그래서 `row.quantity` 가 DB 와 다를 수 있음 → 서버가 DB 값으로 판정해야 한다.
   - `quantity` 없음 또는 `= DB quantity` → **전체 이동**: `UPDATE SET box_code, box_info_id WHERE id = ? AND shipment_id IS NULL AND type = 'PACKED'` + 영향 행 수 확인(0이면 다른 담당자가 그 사이 출고한 것 → 해당 행 실패로 보고).
   - `0 < quantity < DB quantity` → **분할 이동**: SQL 함수 `ft_split_outbound_move(p_id, p_qty, p_box_info_id, p_box_code)` 호출(원자성).
   - 그 외(0, DB 수량 초과, 정수 아님) → 400 + 어떤 행이 왜 거절됐는지 목록 반환.
   - 여러 행 처리 중 일부 실패 시: 성공한 행은 그대로 두고(각 행이 독립 트랜잭션) 응답에 성공/실패 목록을 나눠 담는다. 프론트는 재조회 후 실패 행만 alert.
4. 응답: `{ success, moved_full, moved_split, skipped }` → 프론트는 로컬 패치 대신 `fetchData(selectedUserId)` 재조회(새 행 id 반영).

### SQL — `supabase/shipment/001_split_outbound_move.sql`

```sql
create or replace function ft_split_outbound_move(
  p_id uuid, p_qty int, p_box_info_id uuid, p_box_code text
) returns uuid language plpgsql as $$
declare v_src ft_fulfillment_outbounds%rowtype; v_new_id uuid;
begin
  -- 잔여 수량 차감: 화면 stale 수량 방어 (quantity > p_qty 조건), 미출고 행만
  update ft_fulfillment_outbounds
     set quantity = quantity - p_qty
   where id = p_id and shipment_id is null and type = 'PACKED' and quantity > p_qty
  returning * into v_src;
  if not found then raise exception 'SPLIT_REJECTED' using errcode = 'P0001'; end if;

  insert into ft_fulfillment_outbounds
    (created_at, order_item_id, type, quantity, note, order_no, product_no, product_id,
     box_code, box_info_id, operator_id, operator_name, user_id)
  values
    (v_src.created_at, v_src.order_item_id, 'PACKED', p_qty, v_src.note, v_src.order_no,
     v_src.product_no, v_src.product_id, p_box_code, p_box_info_id,
     v_src.operator_id, v_src.operator_name, v_src.user_id)
  returning id into v_new_id;
  return v_new_id;
end $$;
```
- `created_at` 원본 복사 이유: 2-2 참조. 이동 시각 자체를 남기려면 `note` 에 `'{from} → {to} 분할이동 {ts}'` 추가 가능 → **[결정 C]**.
- 함수 1회 호출 = 1트랜잭션 → UPDATE 와 INSERT 가 함께 성공/실패.

### 영향 범위 점검 (변경 후에도 유지되어야 할 것)

- 출고(`POST /api/ft/shipments`): 체크 행 id + box_codes 로 동작 → 새 행도 그대로 출고 가능.
- 합배송: `ft_box_info.master_box_*` 기준 → 박스를 따라감, 추가 처리 없음.
- 엑셀·품목요약·rowSpan 그룹: box_code 정렬 기반 → 재조회로 반영.
- 기존 `PATCH /api/ft/shipment-v2` 는 다른 필드 수정용으로 유지, 이동은 새 엔드포인트로 이관.

## 2-4. 검증 시나리오 (운영 DB 이므로 테스트 유저 데이터로)

1. 단건 10 → 5 분할: 원본 5, 신규 5(같은 created_at), `total_qty` 불변, 옛 박스 삭제 가드 카운트 감소 확인.
2. 단건 qty = quantity: 행 1개 유지, box_code·box_info_id 모두 갱신.
3. 다건: 수량 입력 비활성, 전체 이동, 이미 대상 박스인 행 스킵.
4. 오류: 출고된 박스 지정 / 다른 유저 박스 / 수량 초과 → 4xx 메시지.
5. 동시성: 두 탭에서 같은 행 분할 시 두 번째가 `SPLIT_REJECTED`.
6. `npm run type-check`.

---

# Part 3. 배송완료 이력 축적 — 스냅샷 업로드에 "이벤트 기록" 추가

## 3-1. 현재 구조와 왜 이력이 안 남는지

- 업로드 경로는 **하나**: `POST /api/upload-delivery-status-csv` (`app/api/upload-delivery-status-csv/route.ts`). 호출하는 화면 3곳 — `order-status-v2/components/DeliveryStatusTools.tsx`, `import-product-v2/ItemCheck.tsx:1190`, `import-product/ItemCheck.tsx:635` (V1). 셋 다 응답의 `savedCount` 만 사용.
- 흐름: 검증 → `loadPrevStates()` 로 이전 스냅샷 읽기 → `status_since/location_since` 이어받기 → **전체 삭제** → 삽입. 이어받기 덕분에 "이 상태가 된 시점" 은 있지만, 주문이 CSV 에서 빠지는 순간 그 행 자체가 사라진다.
- 1688 크롤러(v3)는 待发货·待收货 탭만 긁는다(현재 스냅샷 탭 분포: 待收货 1,296 / 待发货 17). 배송완료(已签收) 후 수령확인(已收货未到账)이 끝나면 주문은 다른 탭으로 넘어가 다음 CSV 에서 사라진다 → 사라지기 전에 기록해야 한다.
- 스냅샷을 읽는 소비자 (모두 **읽기만**, 스키마 변경 없음 → 영향 없음)
  - `app/api/ft/1688-delivery-status/route.ts` → `order-status-v2` (`use1688DeliveryStatus`, `deliveryAlerts.ts`, `FulfillmentLogModal.tsx`)
  - **purchase-agent** 프로젝트: `app/progress/orders/hooks/useItemsTableData.ts:271` 가 Supabase 클라이언트로 테이블을 **직접** 조회하고 `lib/deliveryAlerts.ts` 로 확인필요 판정. 업로드는 하지 않음.
  - `app/db/database/pageTableMap.ts` (문서용 매핑) — 새 테이블 이름만 추가.
- `status_since` 실측: 최초값 2026-09-22 04:45 (기능 도입 시점). 업로드 일자 분포 9/22·23·24·27·28 → **하루 1회 전제가 이미 깨진 날(9/25·26)이 있다.** 배송완료 시각의 정확도는 업로드 간격에 좌우된다.
- 배송완료 행의 `description` 은 NULL → CSV 에는 실제 서명(签收) 시각이 없다. 따라서 "배송완료 시각" 은 항상 **업로드 시점 기반 추정**이다.

## 3-2. 설계 원칙

1. 스냅샷 테이블·읽기 API·purchase-agent 는 **손대지 않는다**. 이력은 별도 테이블에 **추가만** 한다(삭제 없음).
2. 이력 기록은 **삭제보다 먼저, 검증 뒤에** 실행한다. 이력 기록이 실패하면 업로드 전체를 중단하고 스냅샷은 그대로 둔다(현재 "검증 실패 시 삭제하지 않음" 원칙과 동일).
3. 같은 파일을 두 번 올려도 결과가 같아야 한다(멱등). "처음 배송완료로 보인 시각" 은 뒤로 미뤄지지 않는다.
4. 시각은 **구간**으로 저장한다. 전환을 관찰한 업로드 시각(상한)과, 아직 아니었던 직전 업로드 시각(하한). 통계는 둘의 중간값을 쓴다.
5. 병합 로직(`LEAST`, `COALESCE`)은 Postgres 함수 안에서 `INSERT … ON CONFLICT` 로 처리해 동시 업로드에도 안전하게 한다.

## 3-3. 새 테이블 `im_1688_delivery_history` — `supabase/delivery/001_delivery_history.sql`

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `order_no` | text **PK** | 1688 주문번호 (`"1688_order_no"` 와 동일 값) |
| `ordered_at` | timestamptz | 주문일시 (CSV `timestamp`, 중국시간 → UTC 변환된 값). 최초 1회만 기록 |
| `shipped_seen_at` | timestamptz | phase 가 `pickup/transit` 로 처음 관찰된 업로드 시각 (상한) |
| `shipped_after_at` | timestamptz | 그 직전 업로드 시각 (하한, 이전 관찰이 있을 때만) |
| `delivered_seen_at` | timestamptz | phase 가 `delivered` 로 처음 관찰된 업로드 시각 (상한) |
| `delivered_after_at` | timestamptz | 그 직전 업로드 시각 (하한, 이전 관찰이 있을 때만) |
| `delivered_status` | text | 그때의 원문 상태 (`已签收` / `已收货未到账`) |
| `last_status` | text | 마지막 관찰 상태 (환불 전환 등 추적용) |
| `last_seen_at` | timestamptz | 마지막으로 CSV 에 등장한 업로드 시각 |
| `courier`, `tracking_no` | text | 최신값 |
| `created_at`, `updated_at` | timestamptz | |

인덱스: PK 외에 `delivered_seen_at` (처리속도 기간 필터용).

**권한**: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` 에 정책 없이 두어 서버(service role)만 읽고 쓴다. `im_1688_delivery_history_apply`, `ft_split_outbound_move`, `db_process_speed` 세 함수 모두 `REVOKE EXECUTE FROM anon, authenticated` — purchase-agent 가 같은 프로젝트를 anon/authenticated 클라이언트로 쓰므로 브라우저에서 직접 호출되지 않게 막는다.

**추정 배송완료 시각(뷰 또는 함수에서 계산)**
`delivered_at = CASE WHEN delivered_after_at IS NULL THEN delivered_seen_at ELSE delivered_after_at + (delivered_seen_at - delivered_after_at)/2 END`
하한이 없는 행(첫 업로드에 이미 배송완료였던 주문)은 상한만 있어 **늦게 잡힌 값**이다 → 통계에서 `estimate_kind = 'upper_only' | 'midpoint'` 로 구분 → **[결정 F]**.

## 3-4. 업로드 API 변경 (`upload-delivery-status-csv/route.ts`)

단계 7(이어받기)과 8(삭제) 사이에 **7-b) 이력 반영** 을 넣는다.

1. **주문당 1행으로 압축**: 구 형식 CSV 는 한 주문이 탭별로 여러 행 등장(待发货 플레이스홀더 행 포함). `1688-delivery-status/route.ts` 의 `rowScore`(탭 우선순위 > 상세 유무 > 최신) 를 `lib/deliveryRowPick.ts` 로 옮겨 **읽기 API 와 업로드가 같은 기준**으로 대표 행을 고른다. 이걸 안 하면 플레이스홀더 행이 `pending` 으로 잡혀 전환 판정이 흔들린다.
2. 대표 행마다 `phase = deliveryPhase(delivery_status)` 계산 (`lib/deliveryPhase.ts`, 기존 함수 그대로).
3. rpc `im_1688_delivery_history_apply(p_upload_at timestamptz, p_rows jsonb)` **단일 호출** (1,300행 ≈ 300KB, 청크로 나누면 한 업로드가 부분 반영될 수 있어 나누지 않는다. 행 수가 수만 건이 되면 그때 재검토). 함수 내부 규칙:
   - `INSERT … ON CONFLICT (order_no) DO UPDATE` — `DO UPDATE SET` 절에서 테이블명으로 참조하는 값은 **갱신 전 기존 행**이므로 `delivered_after_at = 기존.last_seen_at` 이 의도대로 "직전 업로드 시각" 이 된다(구현 시 이 점을 주석으로 남길 것).
   - `ordered_at = COALESCE(history.ordered_at, new.ordered_at)`
   - phase = `delivered` 이고 `history.delivered_seen_at IS NULL` 이면: `delivered_seen_at = p_upload_at`, `delivered_after_at = history.last_seen_at` (이전 관찰이 있을 때만, 없으면 NULL), `delivered_status = 상태원문`
   - phase ∈ {`pickup`,`transit`} 이고 `shipped_seen_at IS NULL` 이면 같은 방식으로 `shipped_*` 기록
   - 이미 기록된 `*_seen_at` 은 **절대 덮어쓰지 않음** (멱등 + 환불 전환으로 상태가 되돌아가도 유지)
   - `last_status`, `last_seen_at = p_upload_at`, `courier/tracking_no`, `updated_at` 은 매번 갱신
   - 함수 시작에 `pg_advisory_xact_lock(hashtext('im_1688_delivery_history_apply'))` → 두 담당자가 동시에 올려도 직렬화
4. `status_since` 를 이력 판정에 쓰지 **않는다**. `status_since` 는 이어받기라 "처음 관찰 시각" 과 같아 보이지만, 스냅샷 삭제·재삽입 사이에 실패하면 어긋날 수 있다. 이력은 `last_seen_at`(직전 업로드) 과 `p_upload_at`(이번 업로드) 만으로 닫힌 구간을 만든다.
5. 실패 처리: rpc 오류 → `fail('배송 이력 기록 중 오류 — 기존 데이터는 그대로 유지했습니다.', 500)` 후 종료(삭제 전이므로 스냅샷 무손실). 그 뒤 삭제/삽입 실패는 기존과 동일하게 처리하되, 같은 파일 재업로드 시 이력은 멱등이라 중복 기록 없음.
6. 응답에 `history: { applied, newlyShipped, newlyDelivered }` 추가. 기존 필드(`savedCount`, `count`, `errorCount`) 유지 → 호출 화면 3곳 수정 불필요. (`DeliveryStatusTools.tsx` 의 완료 alert 에 "배송완료 신규 n건" 을 덧붙일지는 선택.)

## 3-5. 처리속도 계산에서의 사용 규칙

- 배송 = `delivered_at(추정)` − `ordered_at`. 둘 다 있는 주문만. 항목(`ft_order_items`) 단위로 펼치되 같은 주문의 항목은 같은 값을 가진다.
- 입고 = 첫 ARRIVAL `created_at` − `delivered_at(추정)`.
  - ARRIVAL 이 `delivered_after_at`(하한) 보다 **앞** → 배송완료 전에 입고된 셈이라 데이터 오류(주문번호 매칭 오류 등) → 제외 + `n_skipped`
  - ARRIVAL 이 하한~상한 **사이** → 실제 배송완료 직후 바로 입고된 것 → 0일로 계산
  - 그 외 정상 계산
- 화면 안내문에 "배송완료 시각은 CSV 업로드 시점 기반 추정(업로드 간격만큼 오차)" 을 명시하고, 탭 상단에 `마지막 배송상황 업로드: {max(last_seen_at)}` 표시 → 업로드가 며칠 빠지면 바로 보이게.

## 3-6. 부트스트랩 (1회 실행, `supabase/delivery/002_delivery_history_bootstrap.sql`)

현재 스냅샷 1,313행을 이력에 시딩한다. `ordered_at = timestamp`, `last_seen_at = created_at`(마지막 업로드 시각), `last_status = delivery_status`. 배송완료 1,206행은 `delivered_seen_at = status_since`, `delivered_after_at = NULL`(하한 불명 → upper_only). 운송중 행은 `shipped_seen_at = status_since`. `ON CONFLICT DO NOTHING` 으로 재실행 안전. 실행 전 건수 검증 쿼리 포함.

## 3-7. 논리 검증 체크리스트

| 시나리오 | 기대 결과 |
|---|---|
| 같은 CSV 두 번 업로드 | `*_seen_at` 불변, `last_seen_at` 만 갱신, 응답 `newlyDelivered = 0` |
| 어제 운송중 → 오늘 배송완료 | `delivered_after_at = 어제 업로드`, `delivered_seen_at = 오늘`, 추정 = 중간값 |
| 처음 등장부터 배송완료 (신규 주문인데 이미 도착) | `delivered_after_at = NULL`, upper_only 로 분류 |
| 배송완료 → 다음 업로드에서 CSV 에서 사라짐 | 이력 그대로, 스냅샷만 사라짐. 화면(order-status-v2) 은 기존과 동일하게 "배송정보 없음" |
| 배송완료 → 환불 탭(退款售后)으로 재등장 | `delivered_*` 유지, `last_status` 만 환불 상태로 |
| 구 형식 CSV(주문 중복 행) 업로드 | 대표 행 1건으로 판정, 플레이스홀더 무시 |
| 검증 실패 파일(`订单详情` 섞임) | 이력·스냅샷 모두 무변경 (기존 동작 유지) |
| 이력 rpc 실패 | 스냅샷 무변경, 500 응답 |
| 두 담당자 동시 업로드 | advisory lock 으로 직렬화, `*_seen_at` 은 먼저 끝난 쪽 값 |
| purchase-agent 화면 | 테이블·컬럼 변경 없음 → 영향 없음 (type-check 대상 아님) |

## 3-8. 운영 전제와 남는 한계 (설계로 제거되지 않는 것)

- 정확도는 **업로드 빈도**에 비례한다. 하루 1회(가능하면 오전 고정 시각) 업로드를 운영 규칙으로 두고, 처리속도 탭의 "마지막 업로드" 표시로 누락을 확인한다.
- **오래된 CSV 를 나중에 올리는 경우**: CSV 에는 수집 시각이 없어 서버가 "이 파일이 어제 것" 임을 알 수 없다. 이력에서 이미 기록된 `*_seen_at` 은 보호되지만, 그 파일에서 아직 미배송으로 보이는 주문의 `last_seen_at` 이 오늘로 갱신되어 다음 전환의 하한이 실제보다 늦어질 수 있다(중간값이 최대 업로드 간격의 절반만큼 늦어짐). 스냅샷 자체도 과거로 되돌아가는 기존 문제와 같은 성격 → 운영 규칙 "가장 최근에 수집한 파일만 업로드" 로 다룬다. 크롤러가 파일명에 수집 시각을 넣도록 바꾸면 서버 검증이 가능해지므로 후속 과제로 기록.
- 배송완료는 **1688 주문 단위**다. 한 주문에 항목이 여럿이고 일부만 먼저 도착해도(`部分已发货`) 항목별로 나눌 수 없다 → 항목은 주문의 값을 공유한다.
- 이력 시작 이전(2026-09-22 전) 배송완료 주문은 복구 불가. 처리속도 배송·입고 열은 그 이후 주차부터 채워지며, 부트스트랩 1,206건은 하한 없는 upper_only 다.

---

## 3. 결정 필요 사항

| # | 항목 | 제안 |
|---|---|---|
| A | 배송/입고 단계 이력: Part 3 이력 테이블 도입 | **도입** (Part 1 배송·입고 열의 전제) |
| F | 하한이 없는 배송완료(upper_only) 를 배송·입고 평균에 포함할지 | 포함하되 `n(추정 n')` 로 표기. 제외 토글은 후속 |
| G | `shipped_*`(발송 시각) 도 함께 기록해 배송을 "주문→발송 / 발송→도착" 으로 나눌 여지 | 기록만 하고 화면은 배송 1열 유지 |
| B | 이동 시 박스 타입 ≠ 상품 사이즈 | 차단 아닌 확인창 |
| C | 분할 행 `note` 에 이동 이력 기록 | 기록 (추적 편의) |
| D | 처리속도 통계 지표 | 평균 + 표본수만. 중앙값은 필요 시 추가 |
| E | 처리속도 표 형식 | 사이즈 선택 + 단계별 열 (사이즈 간 비교표는 후속) |

## 4. 작업 순서

1. **Part 3 먼저** — 이력 테이블 + apply 함수 → 부트스트랩 → 업로드 API 7-b 삽입 → `lib/deliveryRowPick.ts` 공용화 → 같은 파일 2회 업로드로 멱등 검증. 이력은 하루라도 빨리 쌓여야 하므로 최우선.
2. Part 2 — SQL 분할 함수 → move API → MoveModal 컴포넌트 → i18n → 검증 (Part 3 과 독립, 병행 가능)
3. Part 1 — 집계 SQL 함수 → process-speed API → 탭 분리 리팩터 → ProcessSpeedTab → 검증
4. 각 파트 별도 커밋

---

## 5. 구현 결과 (2026-09-28)

### 결정 사항 적용
A 도입 / B 확인창(차단 안 함) / C note 에 이동 이력 기록 / D 평균 + 표본수 / E 구분·사이즈 토글 + 단계별 열 / F upper_only 포함, "추정 n" 표기 / G `shipped_*` 기록만, 화면은 배송 1열.

### 운영 DB 적용 (mkcxpkblohioqboemmah)
| 마이그레이션 | 내용 | SQL 파일 |
|---|---|---|
| `im_1688_delivery_history` | 이력 테이블(RLS, 정책 없음) + `im_1688_delivered_estimate` + `im_1688_delivery_history_apply` | `supabase/delivery/001_delivery_history.sql` |
| (1회 실행) | 부트스트랩 1,313행 — 배송완료 1,206 / 발송 79 | `supabase/delivery/002_delivery_history_bootstrap.sql` |
| `ft_move_outbound` | 전체/분할 이동 | `supabase/shipment/001_move_outbound.sql` |
| `db_process_speed` | 처리속도 집계 (jsonb, 약 1.2초) | `supabase/db/001_process_speed.sql` |

쓰기·집계 함수 3개는 `service_role` 만 실행 가능(anon/authenticated 회수 확인).

### 계획과 달라진 점
- **이력 apply 함수 인자**: `p_upload_at` 을 받지 않고 함수 안에서 advisory lock 획득 **후** `clock_timestamp()` 로 정한다. 동시 업로드에서도 하한 < 상한이 보장되고, 앱 서버 시계에 의존하지 않는다.
- **이동 함수 하나로 통합**: 분할 전용 `ft_split_outbound_move` 대신 `ft_move_outbound(p_id, p_box_info_id, p_user_id, p_qty)` 가 전체/분할을 모두 처리한다. 박스 `FOR SHARE` + 행 `FOR UPDATE` 잠금과 검증을 두 경우가 공유하고, 박스코드는 함수가 `ft_box_info` 에서 직접 읽는다(인자로 받은 코드와 id 가 어긋날 여지 제거).
- **다건 이동 시 박스 제외 규칙**: 선택 행이 모두 같은 박스일 때만 그 박스를 목록에서 뺀다(여러 박스에서 골라 그중 한 박스로 모으는 경우를 허용). 이미 대상 박스인 행은 서버가 SKIPPED 처리.
- **처리속도 API 응답**: 평균 대신 `sumDays / n` 을 내려 화면에서 기간 합산(가중 평균)이 가능하게 했다.
- **입고 단계 upper_only**: 첫 입고가 상한(처음 배송완료로 본 업로드)보다 앞서면 실제 배송완료 시각을 알 수 없으므로 **제외**(오류 아님, `n_skipped` 에도 넣지 않음). 하한이 있는 행은 하한 이전 입고만 오류(skip), 하한~추정시각 사이는 0일.

### 검증
- 이력 apply: 가짜 주문 3건으로 업로드 3회 시뮬레이션 — 중간값 추정, upper_only, 같은 파일 재업로드(신규 0), 환불 전환 후 배송완료 유지, 택배사 빈값 유지, 입력 중복 제거 확인 후 테스트 행 삭제.
- 이동 함수: 롤백 트랜잭션 안에서 임시 박스·행으로 분할(합계 불변·created_at 복사·note), 같은 박스 SKIPPED, 초과/0 수량, 다른 사용자, 출고된 박스, 없는 박스, 전체 이동(box_info_id 갱신), 출고된 행 거부, 옛 박스 잔여 0 확인. 롤백 후 잔여 데이터 없음 확인.
- 처리속도: 세트 수작업 대조 — 대표 항목보다 다른 부품이 늦게 온 세트에서 포장 소요 1.0일(대표 항목만 보면 5.1일)로 형제 기준이 적용됨을 확인. 포장·출고 20,327행, 역전 0.
- move API 입력 검증 6종 + 출고된 박스 409, process-speed API 접근코드 없으면 401.
- `npm run type-check` 통과. 로컬 `npm run build` 는 기존 `app/api/save-barcode-data/route.ts` 의 `os.homedir()/Documents` 경로 추적이 Windows 의 `My Pictures` 정션에서 EPERM 으로 실패 — 이번 변경과 무관한 로컬 환경 문제(Railway Linux 빌드에는 해당 없음).
- 화면 확인 한계: `/db/volume` 은 DB 관리 접근코드가 필요해 처리속도 탭 화면은 직접 보지 못했고, 작업 시점에 미출고 행이 0건이라 이동 모달도 실제 행으로 열어보지 못했다.

### 작업 중 발견 (범위 밖, 별도 작업으로 분리)
- `POST /api/ft/shipments` 가 `ft_box_info` 를 `box_code` 만으로 갱신해, 코드가 재사용된 **과거 박스들의 `shipment_id` 까지 덮어쓴다**. 2026-09-28 출고 4건이 열린 박스 90개에 대해 545/559/11/48 박스를 가리키게 됨.

### 배포 후 할 일
- 업로드 API 변경이 배포되기 전까지 올린 배송상황 CSV 는 이력에 반영되지 않는다. 배포 직후 부트스트랩 SQL 을 한 번 더 실행하면(ON CONFLICT DO NOTHING) 그사이 새로 나타난 주문을 시딩할 수 있다.
