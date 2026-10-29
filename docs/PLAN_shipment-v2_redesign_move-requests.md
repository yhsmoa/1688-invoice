# 작업 계획 — 쉽먼트 V2 재설계 · 고객 이동요청(purchase-agent 연계) · 물량관리 접근 확대

작성일: 2026-10-29 · 상태: **2차 검토 반영 (2026-10-29) — 구현 착수 가능** · 보류 1건(엑셀 박스사이즈 열, §3-6)
대상
- 1688-invoice: `/shipment-v2`, `/db/volume`(물량관리), `/api/ft/shipment-v2*`, `/api/ft/box-info`, `/api/db/*`
- **범위 제외(1차 검토)**: S(STOCK·보관) 이동요청 — 개념이 더 정리된 뒤 별도 계획으로. 이번엔 A/B/C/P/X 다섯 타입만.
- purchase-agent: `/progress/orders?status=READY_TO_SHIP` (`app/progress/orders/ShippingReadyView.tsx`)
- Supabase(manage-item, `mkcxpkblohioqboemmah`): 새 테이블 2개(`ft_move_requests`, `ft_shipment_manual_items`) · 컬럼 1개(`ft_fulfillment_outbounds.manual_item_id`) · 함수 4개(이동요청 3 + 수동생성 1) · 정책 2개 · `ft_move_outbound` 갱신 1

---

## 0. 조사 요약 (운영 DB 실측, 2026-10-29)

| 테이블 | 건수 | 비고 |
|---|---|---|
| `ft_fulfillment_outbounds` | 28,794 | 미출고(PACKED & `shipment_id IS NULL`) **1,120행** — BZ 492 / BO 624 / BR 4. 미출고 행의 `box_info_id` NULL **0건** (박스 조인은 id 기준으로 안전) |
| `ft_box_info` | 2,156 | 열린 박스(PACKING & 미출고) **148개**. `size` 는 `60x50x40` 형식 문자열, `status` 값은 `PACKING` 하나뿐 (출고 여부는 `shipment_id` 로 판정). **RLS 켜짐 + 정책 0개 → anon(purchase-agent)은 한 행도 못 읽음** |
| `ft_order_items` | 40,406 | `status` 는 DONE 36,411 / PROCESSING 3,948 / new 47. `customs_category` 는 한글(티셔츠 15,321 …) + 오염값(`알 수 없음` 106, `레깅스 (카테고리에 없어…)` 2, `-`, `케으프`) |
| `invoiceManager-Customs` | 20 | `item_name_ko ↔ item_name_en ↔ HS_code`. 20행 모두 영문 있음. `customs_category` 상위 16종이 `item_name_ko` 와 정확히 일치. **미매핑**: 모자·스타킹·스카프·키링·슈즈·양말·수영복·담요·케이프 등 |
| `ft_users` | 5 | BO 설온 / BR·BZ 아이엠몽 / HI 안녕릴리 / MB 무드베이지 |
| `invoiceManager_employees` | — | `access_authorization = true` 는 **YUHWA(기업)** 과 **韩笑贤(한소현, 매니저)** 2명뿐 |

- 1000행 한계: 1688 쪽 `GET /api/ft/shipment-v2` 는 `fetchAll`/`batchIn` 으로 안전. **purchase-agent `ShippingReadyView` 1단계 조회(`ft_fulfillment_outbounds` PACKED 미출고)는 `range()` 없이 단일 요청** → BO 624행으로 아직 미만이지만 잠재 결함. 이번에 파일을 고치면서 `range` 루프로 교정한다(CLAUDE.md 규칙 5).
- purchase-agent 쓰기 규약: 트랜잭션이 필요한 쓰기는 DB 함수(rpc)로 두고 `(supabase as any).rpc(...)` 호출 (`customer_check_answer` 선례). 테이블은 RLS 끄고 anon 권한 부여.
- 1688-invoice 는 service role 로 직접 접근. SQL 은 `supabase/<domain>/NNN_*.sql` 로 보관 후 운영 DB 에 적용.
- 디자인은 목업 없이 **바로 `ShipmentV2.css` 로 구현**한다(1차 검토 결정 7). 방향은 §1-1.

---

# Part 0. 물량관리 — 한소현 계정 접근 (요청 첫 줄)

## 0-1. 현황
- `/db/volume` 은 `component/DbAccessGate.tsx` 로 감싸져 있고, `/api/db/verify-access` → `lib/dbAccess.ts verifyDbAccessCode()` 가 **`access_authorization = true` AND `role = '기업'`** 을 요구한다. 데이터 API(`/api/db/volume-weekly`, `/api/db/process-speed`)도 `guardDbRoute()` 로 같은 조건을 재검증한다.
- 韩笑贤 은 `role='매니저'`, `access_authorization=true`, 코드 보유 → 지금은 `role` 조건에서 403.
- 같은 게이트를 `/db/orders`, `/db/database`, `/invoice/trade-account` 가 공유한다 → 이 페이지들은 그대로 '기업' 전용이어야 한다.

## 0-2. 설계 — 접근 범위(scope) 도입, 이름 하드코딩 없음
| 범위 | 통과 조건 | 사용 페이지 |
|---|---|---|
| `db` (기본, 현재와 동일) | `access_authorization` AND `role='기업'` | `/db/orders`, `/db/database`, `/invoice/trade-account` |
| `volume` (신규) | `access_authorization = true` AND `role IN ('기업','매니저')` | `/db/volume` + `/api/db/volume-weekly`, `/api/db/process-speed` |

- 1차 검토 결정 1 "매니저만": 플래그 외에 **직책 조건을 추가**한다. '기업'(YUHWA, 지금도 접근 가능)은 유지하고 '매니저' 를 더 허용 → 지금 정확히 YUHWA + 한소현 2명. 검수·기타 직책은 플래그가 켜져 있어도 거절. 직책·플래그 모두 DB 값이라 이름·ID 하드코딩 없음.
- 직책 목록은 `lib/dbAccess.ts` 상수 `DB_ACCESS_ROLES: Record<DbAccessScope, string[]>` 한 곳에 둔다 (`db: ['기업']`, `volume: ['기업','매니저']`).

## 0-3. 변경 파일
- `lib/dbAccess.ts`: `export type DbAccessScope = 'db' | 'volume'`, `verifyDbAccessCode(code, scope = 'db')`, `guardDbRoute(request, scope = 'db')`, `requireDbAccess(request, scope = 'db')`. 거절 문구를 범위별로("물량관리 접근 권한이 없습니다.").
- `app/api/db/verify-access/route.ts`: body `{ code, scope? }` — 허용 목록 외 scope 는 400.
- `component/DbAccessGate.tsx`: `scope?: DbAccessScope` prop → 검증 요청 body 에 포함. sessionStorage 키는 하나(`db-access-code`)를 유지한다. 한소현이 `/db/orders` 로 가면 마운트 재검증이 실패해 코드가 지워지고 잠금 화면이 뜬다(의도된 차단).
- `app/db/volume/page.tsx`: `<DbAccessGate scope="volume" title="물량관리">`.
- `app/api/db/volume-weekly/route.ts`, `app/api/db/process-speed/route.ts`: `guardDbRoute(request, 'volume')`.
- `app/db/database/pageTableMap.ts` 설명 문구 갱신.

검증: YUHWA 코드로 3개 페이지 모두 통과 / 한소현 코드로 `/db/volume` 통과 + 데이터 로딩, `/db/orders`·`/db/database`·무역계좌 403 / 권한 없는 직원 코드 403 / 헤더 없이 `/api/db/volume-weekly` 직접 호출 401.

---

# Part 1. 쉽먼트 V2 (1688-invoice) — 화면 재설계 + 기능 추가

## 1-1. 디자인 방향 (요청 1·2·10)
- 레이아웃: `헤더(제목 · 사용자 선택 · 총 건수)` → **타입 카드 보드** → `액션 바` → `보조 필터 칩(품목 · 쉽먼트에러, 기존 SummaryFilterBar)` → 테이블.
- **타입 카드 보드** `[전체] [A] [B] [C] [P] [X] [요청]` — 각 카드에 `박스 n · 상품 n행` 두 숫자. 카드 색은 사이트 공용 팔레트(`globals.css .size-badge--*`: A/B/C 파랑, P 주황, X 검정)를 **상단 색띠 + 큰 숫자**로 쓰고, `[요청]` 카드는 보라(`#7c3aed`) 계열로 구분해 미처리 이동요청 수를 보여준다. 카드 클릭 = 필터(같은 카드 재클릭 = 전체).
  - 타입 판정은 행의 `box_code` 타입(`getBoxType`). 합배송된 박스(`master_box_code` 있음)도 자기 박스 타입으로 센다(요약은 "박스가 어디에 있나" 가 아니라 "어떤 박스에 담겼나").
  - `[요청]` = `move_request.status = 'REQUESTED'` 인 행.
  - 카드 보드와 기존 품목·에러 칩은 **AND** 로 결합(타입 A 안에서 티셔츠만 보기 가능). `utils/rowFilter.ts` 의 `RowFilter` 를 `{ board: BoardFilter; chip: ChipFilter }` 2축으로 확장.
- 테이블: 행 높이·여백을 줄여 밀도 유지, 헤더는 작은 대문자형 라벨(purchase-agent 표와 톤 통일), 박스 셀은 `배지 + 사이즈(작은 회색, 클릭 시 수정 §1-5)`, 수량 3열은 tabular-nums. 수량 불일치 행 주황 배경·체크 행 파랑 배경은 유지(현장이 익숙한 신호).
- 액션 바 버튼은 `주 동작(출고: 빨강)` / `보조 동작(흰 배경 테두리: 품목·엑셀·이동·합배송·생성·박스라벨)` / `저장(변경 있을 때만 녹색)` 3단계로 톤을 나눈다.
- 구현 순서: ① 컴포넌트 분리(동작 동일) ② `ShipmentV2.css` 전면 정리(섹션 주석 유지) ③ 새 기능. 목업 단계는 두지 않는다(결정 7).

## 1-2. 컴포넌트 구조 (CLAUDE.md 규칙 2 — 915행 단일 컴포넌트 해소)
```
app/shipment-v2/
  ShipmentV2.tsx                 — 상태·데이터 로딩·필터 조합만 (얇게)
  types.ts                       — ShipmentV2Row 확장: box_info_id, box_size, master_box_type,
                                    customs_category_en, move_request
  components/
    TypeBoardCards.tsx           — [전체][A][B][C][P][X][요청] 카드 (신규)
    SummaryFilterBar.tsx         — 품목/에러 칩 (기존, 영문 표기만 변경)
    ShipmentTable.tsx            — 테이블 (ShipmentV2.tsx 에서 분리)
    ShipmentTableRow.tsx         — 행 (박스셀·품목셀·이동요청 버튼)
    BoxSizeEditor.tsx            — 박스 사이즈 인라인 편집 팝오버 (신규 §1-5)
    MoveRequestButton.tsx        — "A 이동요청…" / [처리완료] 버튼 (신규 §1-7)
    ManualItemModal.tsx          — [생성] 모달 (신규 §1-6)
    BoxLabelPrintModal.tsx       — [박스라벨] 모달 (신규 §1-8)
    MoveModal.tsx / 합배송·출고 모달 — 기존 (출고·합배송 모달도 파일로 분리)
  hooks/
    useShipmentRows.ts           — fetch + rowErrors + 필터 파생값
  utils/
    rowFilter.ts, shipmentCodes.ts (기존) + boardSummary.ts (카드 집계)
lib/
  customsCategoryEn.ts           — invoiceManager-Customs 매핑 로더 (서버)
  boxLabelPdf.ts                 — 10x15 라벨 PDF 생성 (box-label 페이지에서 추출, 양쪽 공용)
component/BoxCreateModal.tsx     — SIZE_PRESETS export (사이즈 편집기와 공유)
```

## 1-3. 통관 품명 영문 표기 + 알 수 없음 ❓ (요청 3·4)
- 저장 값(`ft_order_items.customs_category`, 한글)은 바꾸지 않는다. 인라인 편집·Gemini 분류·엑셀(품목별 통관서류)이 모두 한글 키를 쓰고 있고, `invoiceManager-Customs.item_name_ko` 가 그 한글을 영문·HS 로 잇는 유일한 매핑이기 때문.
- `GET /api/ft/shipment-v2` 가 `invoiceManager-Customs`(20행) 를 1회 읽어 `customs_category_en` 을 행마다 붙인다. 매핑 규칙: `trim` 후 `item_name_ko` 정확 일치 → `item_name_en`.
- 화면 표시 규칙
  | 저장값 | 표시 |
  |---|---|
  | 매핑 있음 (`티셔츠`) | `T SHIRT` |
  | `알 수 없음` 또는 `알 수 없음` 을 포함하는 오염값(`레깅스 (카테고리에 없어 알 수 없음으로 표시)`) | **빨간 ❓** (title 로 원문 노출) |
  | 비어 있음 | `-` (미분류 칩과 동일) |
  | 매핑 없는 한글 (`모자`, `스타킹` …) | 한글 그대로 + 회색 점(미등록 표시, title "통관정보에 영문 없음") |
- 품목 셀 클릭 편집은 **한글 입력** 그대로(통관정보 페이지와 같은 키). 편집 종료 후 표시만 영문으로 돌아감. 요약 칩(SummaryFilterBar)도 같은 규칙으로 영문 표기, 필터 키는 한글 유지.
- 엑셀 다운로드: `품목` 열은 한글 유지, `품목(영문)` 열 추가 (통관서류 흐름이 한글 열을 읽을 수 있으므로 기존 열은 그대로).
- 참고: Gemini 분류 프롬프트(`classify-products`)의 카테고리 17종 중 `장갑·봉제 인형·체인·쿠션` 은 통관정보에 있고 나머지는 모두 매핑됨. 분류 프롬프트는 이번 범위에서 수정하지 않음.

## 1-4. 박스 사이즈 표시 (요청 5 — 1688 쪽)
- `GET /api/ft/shipment-v2` 4단계 `ft_box_info` 조회를 **`box_info_id` 기준**으로 바꾸고(`box_code` 는 출고 후 재사용되어 과거 박스와 섞일 수 있음 — 미출고 행 `box_info_id` NULL 0건 확인) `id, box_code, size, master_box_id, master_box_code` 를 가져온다. 응답에 `box_info_id`, `box_size` 추가.
- 박스 셀: 배지 아래 `60x50x40` 작은 회색 텍스트. 없으면 `사이즈 없음`(클릭 유도).

## 1-5. 박스 사이즈 수정 (요청 13)
- 사이즈 텍스트 클릭 → 작은 팝오버(`BoxSizeEditor`): 프리셋 3종(`150 60×50×40 / 145 50×50×45 / 120 50×40×30`, `BoxCreateModal.SIZE_PRESETS` 를 export 해 공유) + 가로·세로·높이 직접 입력 → [저장].
- 저장: `PATCH /api/ft/box-info { id: box_info_id, fields: { size } }` (기존 라우트). 성공 시 같은 `box_info_id` 를 가진 모든 행의 `box_size` 를 로컬 갱신(재조회 불필요).
- 서버 보강: 현재 PATCH 는 `fields` 를 그대로 update 한다 → **허용 컬럼 화이트리스트**(`size, weight, status, master_box_id, master_box_code, shipment_id`)를 두고, `size` 는 `^\d{1,3}x\d{1,3}x\d{1,3}$` 검증. 기존 호출(합배송)은 영향 없음.
- 출고된 박스(`shipment_id` 있음)는 미출고 목록에 없으므로 편집 대상에 나타나지 않는다.

## 1-6. [생성] — 수동 쉽먼트 행 추가 (요청 12, 부자재 등)
### 문제의 본질
쉽먼트 행은 `ft_fulfillment_outbounds(PACKED)` 1행이지만 화면의 `바코드·상품정보·옵션·단가·품목·사이즈·입고·전체` 는 모두 `ft_order_items` 조인과 입고(`ARRIVAL`) 계산에서 온다. 부자재는 **주문도 재고도 아닌데** 이 조인에 끼워 넣어야 한다.

### 검토한 두 방식
**A. `ft_order_items` 에 `status='MANUAL'` 가짜 주문 항목을 만들고 ARRIVAL + PACKED 를 넣는 방식 — 기각**
양 저장소의 `ft_order_items` 조회 전수 감사(§4) 결과, 상태 필터를 거는 화면에선 숨겨지지만 **다음 경로로 새어 나간다**:
- purchase-agent 진행상황 **'전체' 탭**에 고객에게 노출(주문번호 없는 행, 장바구니 담기 가능), 장바구니 '불러오기'·정보채우기가 바코드 매칭으로 부자재 행의 가격·이미지를 가져올 수 있음.
- `match-order-id`(1688 주문번호 매칭)가 `1688_order_id IS NULL` 로 긁어가며 1000행 기본 한도를 잠식, `classify-products` 가 품목 캐시에 섞음, `db_process_speed`(처리속도 통계) 표본에 포함.
- 입고 V2 '전체' 모드·주문상태 V2 에도 노출(배송 지연 경고 오탐 가능).
가짜 주문을 만들지 않는 것이 맞다.

**B. 부자재 전용 테이블 + outbound 행에 `manual_item_id` — 채택**
- `ft_shipment_manual_items` (`supabase/shipment/003_manual_shipment_item.sql`): `id, user_id, product_no(화면 "주문번호"), barcode, item_name, option_name, option_note(주문옵션), price_cny numeric, customs_category text, size_code text CHECK IN (A,B,C,P,X), arrival_qty int(입고), created_by, created_at`.
- `ft_fulfillment_outbounds` 에 **컬럼 추가 `manual_item_id uuid NULL`** (FK → manual_items, ON DELETE RESTRICT). 수동 행은 `order_item_id = NULL, product_id = NULL, manual_item_id = ✓, note = 'MANUAL'`. 모든 소비자가 컬럼을 명시 선택하므로 additive.
- 함수 `ft_shipment_manual_create(p_user_id, p_box_info_id, p_item jsonb, p_arrival int, p_scan int, p_operator_name, p_operator_no) RETURNS jsonb` — 한 트랜잭션: 박스 검증(같은 user·PACKING·미출고, FOR SHARE) → manual_items INSERT → outbounds PACKED INSERT. 검증: 1 ≤ 스캔 ≤ 입고, 단가 ≥ 0, 상품명·주문번호·사이즈 필수.
- API `POST /api/ft/shipment-v2/manual` → 입력 검증 → rpc → 재조회.
- 모달 필드: **박스(필수 — 요청 목록엔 없지만 PACKED 행은 박스 없이 존재할 수 없음)** · 주문번호 · 바코드 · 상품명 · 주문옵션 · 단가 · 품목(통관정보 `item_name_ko` 드롭다운) · 쉽먼트사이즈(A/B/C/P/X 배지 버튼) · 입고 · 스캔(기본 = 입고) · 담당자/PC-NO(출고 V2 와 동일 소스).

### `order_item_id = NULL` outbound 행을 읽는 모든 코드의 처리 (전수 확인)
| 소비자 | 현재 동작 | 조치 |
|---|---|---|
| `GET /api/ft/shipment-v2` | `orderItems[null]` → 빈 값, `total_qty` 가 null 키로 뭉침 | `manual_item_id` 가 있으면 manual_items 조인으로 바코드·상품명·단가·품목·`size_code` 채움, `available_qty = arrival_qty`, `total_qty` 는 `manual_item_id` 키로 합산. 출고완료(`shipment-complete-v2`)도 같은 라우트라 자동 반영 |
| purchase-agent `ShippingReadyView` | `mergeKey = "null||박스"` 로 **다른 부자재가 한 행으로 합쳐짐** | 키를 `order_item_id ?? manual:${manual_item_id}` 로, manual_items 조인(anon SELECT 필요 → `004` 정책에 함께 포함) |
| `ft_move_outbound`(이동 SQL) | SPLIT INSERT 가 `manual_item_id` 를 복사하지 않음 → 분할 행이 정보 없는 행이 됨 | INSERT 컬럼에 `manual_item_id` 추가 (`CREATE OR REPLACE`, 동일 파일 003 에 포함) |
| `POST /api/ft/shipments`(출고) · `ft_shipment_details` 스냅샷 | id 로 갱신·클라이언트 행을 그대로 저장. `order_item_id` nullable | 변경 없음 (스냅샷은 GET 결과를 저장하므로 상품정보 포함) |
| `lib/confirmDone.ts` | `order_item_id` `filter(Boolean)` | 변경 없음 (주문 상태 전환 대상 아님 — 의도) |
| `DELETE /api/ft/fulfillments` | outbound 단순 삭제 | 변경 없음. 마지막 PACKED 행이 지워져도 manual_items 는 이력으로 남김 |
| `/api/db/volume-weekly`(물량관리 출고 집계) | outbound 수량 합산 | 부자재도 출고 물량에 포함(의도, 안내 문구 없음) |
| `db_process_speed` · 입고 V2 · 주문상태 V2 · 1688 매칭 · 장바구니 | `ft_order_items` 기준 | **노출되지 않음** (A 방식의 누출이 모두 사라짐) |
| purchase-agent 진행상황 출고준비 **건수** | outbound COUNT | 부자재 포함(고객 화면 출고준비 목록과 일치) |

## 1-7. 이동요청 표시·처리 (요청 9·10·11)
### 새 테이블 `ft_move_requests` — `supabase/shipment/002_move_requests.sql`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid not null | 팀(ft_users) — 조회 격리 키 |
| `outbound_id` | uuid not null | `ft_fulfillment_outbounds.id` — **행 1건 = 요청 1건** |
| `request_group_id` | uuid not null | 한 번의 모달 제출로 생긴 요청 묶음 |
| `target_type` | text not null, `CHECK IN ('A','B','C','P','X')` | S(보관)는 이번 범위 밖 — 추후 `ALTER TABLE … DROP/ADD CONSTRAINT` 로 확장 |
| `from_box_code` | text | 요청 시점 박스(표시용 스냅샷) |
| `status` | text not null default `'REQUESTED'`, `CHECK IN ('REQUESTED','DONE','CANCELLED')` | |
| `requested_by` | text | 고객 이름(`AuthUser.full_name`) |
| `requested_at` | timestamptz default now() | |
| `done_by` / `done_at` | text / timestamptz | 창고 담당자(Worker 이름) |
| `note` | text | |
- 인덱스: `(user_id, status)`, `(outbound_id)`, **부분 유니크 `(outbound_id) WHERE status='REQUESTED'`** — 같은 행에 미처리 요청 중복 금지.
- 권한: RLS 끔 + `GRANT SELECT ON ft_move_requests TO anon, authenticated` (고객 포털 조회), 쓰기는 함수로만 (`REVOKE INSERT/UPDATE/DELETE FROM anon`).
- `outbound_id` 에 FK 를 걸지 않는다: 입고 V2 의 포장 철회(outbound DELETE)로 행이 사라질 수 있고, 요청 이력은 남겨야 하기 때문. 대신 조회 때 조인으로 "현재 열린 행만" 판정.

### 함수
1. `ft_move_request_create(p_user_id uuid, p_outbound_ids uuid[], p_target_type text, p_requested_by text) RETURNS jsonb` — anon 실행 허용(고객 포털).
   - 각 id: 존재 · `user_id` 일치 · `type='PACKED'` · `shipment_id IS NULL` 아니면 `request: …` 예외. 이미 REQUESTED 가 있으면 건너뛰고 `skipped` 로 반환. 현재 박스 타입이 이미 `target_type` 이면 역시 skipped(의미 없는 요청 방지).
   - 반환 `{ created: n, skipped: n, group_id }`.
2. `ft_move_request_cancel(p_user_id uuid, p_request_id uuid)` — anon 허용. REQUESTED 만 CANCELLED 로. 고객이 배지 클릭 → 취소 확인 (결정 4 승인).
3. `ft_move_request_complete(p_request_id uuid, p_done_by text) RETURNS jsonb` — **service role 전용**. 함수 안에서 재판정: outbound 행 FOR SHARE → 열린 PACKED 행이어야 하고 `effective_type`(합배송이면 master 박스 타입, 아니면 자기 박스 타입) `= target_type` 이어야 DONE. 다르면 `request: 아직 {현재타입} 박스에 있습니다` 예외.

(함수 3개. S 보관 처리 함수는 범위 제외.)

### 1688 화면
- `GET /api/ft/shipment-v2` 가 `ft_move_requests(status='REQUESTED', outbound_id IN …)` 를 `batchIn` 으로 붙여 `move_request: { id, target_type, requested_by, requested_at } | null` 반환. 응답에 `master_box_type` 도 포함(판정 표시용).
- 상품정보 셀 오른쪽 `MoveRequestButton`:
  - 미처리: `[A] 이동요청…` — 타입 배지색 테두리 + 점 3개 깜빡임(기존 `shipment-v2-badge--error-blink` 와 다른 보라/타입색 애니메이션, `prefers-reduced-motion` 대응). 툴팁: 요청자·시각·요청 시 박스.
  - 클릭 → 즉시 `POST /api/ft/move-requests/{id}/complete`; 성공이면 버튼이 녹색 `[처리완료]` 로 바뀌고, 실패(아직 다른 박스)면 함수 메시지를 alert 로 보여준다. 즉, "이동/합배송으로 옮긴 뒤 버튼을 누르면 맞는지 확인하고 처리완료" 요구 그대로.
  - 처리자(`done_by`)는 페이지 상단에 Worker 드롭다운(`/api/hr/workers`, 입고·출고 V2 와 동일)을 추가해 받는다. 미선택 시 처리 버튼 비활성 + 안내.
- `[요청]` 카드: 미처리 요청 수. 클릭 시 해당 행만.
- 처리 완료 뒤 행 표시: 같은 세션에서는 `[처리완료]` 녹색 고정, 재조회 후에는 REQUESTED 가 아니라 아무 표시 없음(DONE 이력은 purchase-agent 쪽에서 24시간 노출 §2-4).

### 라우트 (service role)
- `POST /api/ft/move-requests/[id]/complete` body `{ done_by }` — rpc 호출 + `request:` 접두 메시지 변환(`move` 라우트의 `MOVE_ERROR_MESSAGE` 패턴).

### 다른 동작과의 상호작용 (논리 모순 점검)
| 상황 | 동작 |
|---|---|
| 요청된 행을 **분할 이동**(SPLIT) | 원본 id 는 남아 요청 유지(남은 수량에 대한 요청으로 해석), 새 행엔 요청 없음. 모달 안내 문구에 명시 |
| 요청된 행을 **전체 이동**(FULL) | id 유지 → 요청 유지 → 새 박스 타입이 맞으면 [처리완료] 가능 |
| 요청된 행을 **출고** | `shipment_id` 가 생겨 "열린 행" 이 아님 → 1688 목록에서 사라지고, purchase-agent 출고준비에서도 사라짐. 요청은 REQUESTED 로 남아 고객 화면 `[요청]` 집계에만 남을 수 있음 → **`GET` 양쪽 모두 "열린 outbound 와 조인되는 요청만" 센다**. 야간 정리 잡은 두지 않고, 출고 API(`POST /api/ft/shipments`)가 출고된 `fulfillment_ids` 의 REQUESTED 요청을 `CANCELLED(note='shipped')` 로 닫는다 |
| 요청 중 박스가 **합배송**됨 | effective_type 으로 판정 (요구사항 9) |
| 고객이 같은 행을 다시 요청 | 부분 유니크로 거절 → skipped 로 응답 |
| 요청된 행이 입고 V2 에서 **포장 철회**(outbound 삭제)됨 | 열린 행과 조인되지 않아 양쪽 목록·집계에서 빠짐. 요청은 REQUESTED 로 남지만 보이지 않음 (이력) |

## 1-8. [박스라벨] (요청 14)
- `/export-invoice/box-label` 의 PDF 생성(10×15cm 세로, 90° 회전 3줄: 날짜 / 위치 / 부피)을 `lib/boxLabelPdf.ts` 로 추출하고 두 화면이 공유. 기존 페이지 동작 변화 없음.
- `BoxLabelPrintModal`
  - 대상 박스: 체크된 행이 있으면 **체크된 행이 속한 박스**, 없으면 화면(현재 필터 적용)의 전체 박스. 박스 = `box_code` 고유값.
  - 상단 타입별 카운트 `A 3/5 · B 0/1 · C 0/0 · P 2/2 · X 1/4` — 분모는 목록 전체 박스 수, 분자는 출력 대상 박스 수. **분자 = 분모(>0)면 녹색**.
  - 날짜 입력(YYMMDD, 기본 오늘) → [출력] → `boxLabelPdf.generate(rows)` 로 PDF 다운로드. 라벨 순서 = `box_code` 오름차순.
  - 라벨 3줄: `날짜` / `box_code` / `부피 = ft_box_info.size` 그대로(예 `60x50x40`, 결정 2). 사이즈가 없는 박스는 3번째 줄 빈칸.
  - 합배송된 하위 박스(`master_box_code` 있음)는 물리적으로 마스터 안에 있으므로 **기본 제외**, 모달에 "합배송 하위 박스 n개 제외" 안내 + 포함 토글.

## 1-9. 기타 정리(같이 처리)
- `app/db/database/pageTableMap.ts` 에 새 라우트·테이블 반영(파일 규칙).
- `locales/ko.json` · `zh.json` `shipmentV2.*` 키 추가(카드 보드, 생성 모달, 이동요청, 박스라벨, 사이즈 편집). 두 파일 동기.
- `GET /api/ft/shipment-v2` 응답 필드 추가는 **모두 additive** — `shipment-complete-v2` 가 같은 라우트를 쓰므로 기존 필드는 유지.

---

# Part 2. purchase-agent 출고준비 화면 (`/progress/orders?status=READY_TO_SHIP`)

## 2-1. 박스 사이즈 표시 (요청 5)
- `ft_box_info` 는 RLS 켜짐·정책 0 → anon 조회 불가. **`supabase/shipment/004_anon_select_policies.sql`**: `CREATE POLICY ft_box_info_anon_select ON ft_box_info FOR SELECT TO anon, authenticated USING (true)` + `ft_shipment_manual_items` 도 같은 SELECT 정책. SELECT 만 열고 쓰기는 그대로 막힌다(다른 ft 표는 RLS 자체가 꺼져 있어 이 표들만 더 보수적인 상태를 유지).
- `ShippingReadyView` 1단계에서 `box_info_id, manual_item_id` 도 선택 → `batchIn('ft_box_info','id, box_code, size, master_box_code','id', boxInfoIds)` → 박스 배지 아래 사이즈 텍스트(없으면 표시 생략). 수동 행은 `ft_shipment_manual_items` 조인(§1-6 표).
- 같은 파일의 1단계 조회를 `range()` 루프로 교정(§0).

## 2-2. 스캔 수량 편집 제거 (요청 6)
- `editingQtyIdx / qtyRef / handleQty*` 와 셀의 `contentEditable` 제거 → 일반 숫자 셀. 이 편집은 로컬 상태만 바꾸고 저장되지 않던 코드라 데이터 영향 없음. 품목 편집은 유지.

## 2-3. [이동요청] 버튼 + 모달 (요청 7)
- 툴바: `[이동요청]`(`ActionButton compact`, 아이콘 `move_down`, 체크 0건이면 disabled) 을 `[xlsx]` 왼쪽에.
- 모달(`components/Modal` 재사용, `components/MoveRequestModal.tsx` 신규): 선택 요약(`n행 · 박스 m개`) + 타입 버튼 5개 — A 소형 / B 중형 / C 대형 / P 개인 / X 직발. 배지색은 `SizeBadgeFilterButton` 의 `size-badge--*` 팔레트(`BOX_TYPES` 와 라벨 키 재사용). S 는 범위 제외.
- 제출: `(supabase as any).rpc('ft_move_request_create', { p_user_id, p_outbound_ids, p_target_type, p_requested_by })`. 화면 행은 `(order_item_id + box_code)` 로 합산된 행이라 `row.ids` 전부를 보낸다. 결과 `skipped>0` 이면 "n건은 이미 요청 중이거나 이미 해당 타입 박스" 안내.
- 서비스 분리: `app/progress/orders/services/moveRequestService.ts` (`createMoveRequests`, `fetchOpenMoveRequests`, `cancelMoveRequest`).

## 2-4. "이동중…" 배지 (요청 8)
- 조회: `ft_move_requests WHERE user_id = me AND status IN ('REQUESTED','DONE') AND (status='REQUESTED' OR done_at > now()-24h)` → `outbound_id` 로 행에 매핑(합산 행은 `ids` 중 하나라도 있으면 표시; 여러 타입이 섞이면 모두 나열).
- 상품정보 셀 오른쪽: `→ [A] 이동중…` — 타입 배지 + 보라 텍스트 + Tailwind `animate-pulse`(`motion-reduce:animate-none`). DONE 은 `✓ [A] 이동완료` 녹색, 24시간 뒤 사라짐.
- 배지 클릭(REQUESTED 만) → "요청을 취소할까요?" → `ft_move_request_cancel` (결정 4 승인).
- 요청 중인 행은 체크해도 모달 제출 시 함수가 skipped 로 돌려주므로 중복 생성되지 않는다.

## 2-5. 엑셀
- **보류(§3-6)**: 출고준비 [xlsx](`downloadShippedExcel`) 열 구성은 이번 작업에서 변경하지 않는다. 화면 행에 `box_size` 가 생겨도 엑셀 매핑에는 넣지 않는다.

---

# 3. 결정 사항 (1차 검토 2026-10-29 반영)

| # | 질문 | 결정 | 반영 위치 |
|---|---|---|---|
| 1 | 물량관리 범위 조건 | **플래그 + 직책 `기업`·`매니저`** (매니저만 추가, 검수 등은 불가) | §0-2 |
| 2 | 박스라벨 3번째 줄 | `ft_box_info.size` **그대로** (`60x50x40`) | §1-8 |
| 3 | S(보관) 처리 정의 | **이번 범위 제외** — 추후 별도 계획. 요청 타입은 A/B/C/P/X 5종, `CHECK` 도 5종 | §1-7, §2-3 |
| 4 | 고객 요청 취소 | **포함** (배지 클릭 → 취소) | §1-7 함수 2, §2-4 |
| 5 | [생성] 설계 + 박스 선택 필드 | **방법 B(부자재 전용 표) + 박스 선택 필드 확정** (2차 검토) | §1-6 |
| 6 | 출고준비 엑셀 박스사이즈 열 | **보류** — 이번 구현에서 `shippedExcel.ts` 는 건드리지 않음. 필요해지면 선택 필드 `box_size?` 로 추가 | §2-5 |
| 7 | 디자인 목업 | **목업 없이 바로 CSS** | §1-1 |

## 설명 5 — [생성] 버튼이 만드는 데이터와 "박스 선택" 이 필요한 이유 (예시)

**상황**: 아이엠몽(BZ)이 부자재 "옷걸이 50개" 를 다음 쉽먼트에 함께 보내 달라고 한다. 주문도 없고 입고 스캔도 없는 물건이다.

**지금 쉽먼트 화면의 한 행이 실제로 어디서 오는지**

| 화면 열 | 실제 데이터 출처 |
|---|---|
| 박스번호 | 포장 기록 행(`ft_fulfillment_outbounds`)의 `box_code` — 포장 스캔 때 "어느 박스에 넣었는지" |
| 주문번호·바코드·상품정보·주문옵션·단가·품목·쉽먼트사이즈 | 그 포장 행에 연결된 **주문 항목**(`ft_order_items`) |
| 입고 | 그 주문 항목의 입고 스캔 합계 − 이미 출고된 수량 |
| 스캔 / 전체 | 포장 행의 수량 / 같은 주문 항목의 미출고 포장 수량 합 |

즉 **한 행 = "포장 기록 1건 + 그 뒤의 주문 항목 1건"** 이다. 포장 기록은 반드시 박스 하나에 속한다(박스 없는 포장은 없음). 그래서 [생성] 모달에 입력하는 9개 값 외에 **"어느 박스에 담겼는가"** 를 하나 더 받아야 한다. 그렇지 않으면 그 행은 박스번호 열이 비고, 박스 단위로 묶이는 이동·합배송·출고·박스라벨 어디에도 들어가지 못한다.

**두 가지 만드는 방법을 비교**

- 방법 A: 옷걸이를 **가짜 주문 항목**으로 `ft_order_items` 에 넣고(상태 'MANUAL') 입고 스캔 1건 + 포장 1건을 같이 넣는다. 화면 조인은 손댈 게 없지만, 양쪽 저장소 조사 결과 고객 포털 진행상황 **'전체' 탭에 "주문번호 없는 옷걸이" 가 보이고 장바구니에 담을 수도 있으며**, 1688 주문번호 자동 매칭·품목 분류 캐시·처리속도 통계에도 섞인다(§4). 부자재는 주문이 아니므로 틀린 자리에 들어가는 것.
- 방법 B(채택 제안): **부자재 전용 표**(`ft_shipment_manual_items`)에 옷걸이 정보(상품명·바코드·단가·품목·사이즈·입고 50)를 저장하고, 포장 행 1건을 만들 때 주문 항목 대신 이 표를 가리키게 한다(새 컬럼 `manual_item_id`). 쉽먼트 V2·고객 출고준비·출고완료 스냅샷은 "주문 항목이 없으면 부자재 표에서 읽는다" 한 줄 분기만 추가. 주문 목록·장바구니·통계는 애초에 주문 항목 표만 보므로 옷걸이가 나타나지 않는다.

**방법 B 로 [생성] 을 누르면 생기는 것(예시 값)**

```
ft_shipment_manual_items   1행  { product_no: 'ETC-HANGER', item_name: '옷걸이', barcode: '',
                                 price_cny: 0.8, customs_category: '옷걸이', size_code: 'C', arrival_qty: 50 }
ft_fulfillment_outbounds   1행  { type: 'PACKED', quantity: 50, box_code: 'BZ-C-02',
                                 box_info_id: <BZ-C-02 id>, order_item_id: NULL, manual_item_id: <위 행 id>, note: 'MANUAL' }
```
→ 쉽먼트 V2 와 고객 출고준비 화면에 `BZ-C-02 | ETC-HANGER | 옷걸이 | 0.8 | 옷걸이 | C | 입고 50 | 스캔 50 | 전체 50` 로 보이고, 이동·합배송·출고·박스라벨에 일반 행과 똑같이 참여한다. 출고 후 출고완료 화면·통관 엑셀에도 그대로 남는다.

**결정(2차 검토)**: 방법 B + 박스 선택(열린 박스 드롭다운 + 새 박스 버튼, 이동 모달 `MoveModal` 과 같은 UI·같은 `/api/ft/box-info` 조회) 확정 → §1-6 그대로 진행.

## 설명 6 — "출고준비 엑셀" 이 무엇인지

- 페이지: purchase-agent `https://purchase.up.railway.app/progress/orders?status=READY_TO_SHIP` (출고준비).
- 버튼: 표 오른쪽 위 **[xlsx]** (요청 7에서 그 왼쪽에 [이동요청] 을 넣기로 한 바로 그 버튼). 누르면 화면의 전체 행을 `출고준비.xlsx` 로 내려받는다. 열은 `박스번호 · 마스터박스 · 주문번호 · 옵션id · 바코드 · 상품정보 · 단가 · 품목 · 쉽먼트사이즈 · 입고 · 출고개수 · 전체` (출고완료 SHIPPED 화면의 [xlsx] 와 같은 함수 `downloadShippedExcel` 을 공유).
- 질문의 뜻: 요청 5로 화면에 박스사이즈가 생기니, 이 엑셀에도 `박스사이즈` 열을 **추가할지** 여부. **2차 검토: 보류** — 이번엔 엑셀 열을 바꾸지 않는다. 나중에 넣을 때는 `ShippedExcelRow.box_size?: string | null` 선택 필드로 추가하고 출고완료 화면은 빈값(사이즈를 스냅샷에 저장하지 않음).

---

# 4. 감사 — `ft_order_items` 조회 전수 (A 방식 기각 근거, 2026-10-29)

양 저장소의 `ft_order_items` 접근 지점을 모두 분류했다. NULL `order_id/order_no/1688_order_id/product_id/set_total` 로 **크래시하는 곳은 없음**(모두 `?? ''`, `|| null`, `set_total > 1 &&` 가드). 문제는 "보이면 안 되는 곳에 보임 / 숫자가 틀림" 이다.

| 분류 | 의미 | 1688-invoice | purchase-agent |
|---|---|---|---|
| A 상태 필터 | `MANUAL` 안 보임 | `confirmDone`(PROCESSING/DONE), export-product-v2 목록, `/api/ft/order-items` 기본 | 진행 카드 건수, PROCESSING/DONE 탭, 혼용률 페이지 |
| B 키 필터 | NULL 이라 제외 | by-delivery-code·order-inspect(`1688_order_id`), by-product-ids·세트 단가(`product_id`) | BoardView(`order_id`), 쿠팡발송(`personal_order_no`), 취소/실패 오퍼(`1688_offer_id`), 세트 조회(`set_total>1`) |
| **C 노출** | 보임·영향 | `/api/ft/order-items?status=ALL`(입고 V2·V3·주문상태 V2 '전체'), lookup(BARCODE 모달), export-xlsx, **match-order-id(`1688_order_id IS NULL`, 페이지네이션 없음)**, classify-products 캐시, `db_process_speed` 표본, order-weekly(orphan 집계) | **진행상황 '전체' 탭(고객 노출, 장바구니 담기 가능)**, 출고준비, 장바구니 불러오기/정보채우기(바코드 매칭), CartAddModal |

- 트리거: `ft_order_items` 에 트리거 없음(저장소 SQL 기준). FK: `ft_personal_invoice_prints.item_id`(CASCADE), `ft_customer_checks.order_item_id`(SET NULL) — INSERT 에는 무관.
- 결론: C 열이 비어 있지 않으므로 가짜 주문 항목 방식은 쓰지 않는다 → §1-6 B 방식.
- 부수 발견(범위 밖, 별도 작업): `match-order-id`·`export-xlsx` 는 1000행 한도 미대응. 기록만 한다.

---

# 5. 작업 순서 (커밋 단위)

| # | 저장소 | 내용 | 의존 |
|---|---|---|---|
| 1 | 1688-invoice | Part 0 물량관리 scope | 없음 — 독립 커밋, 먼저 배포 가능 |
| 2 | DB | `002_move_requests.sql`(테이블·함수 3개·권한), `003_manual_shipment_item.sql`(테이블·컬럼·함수·`ft_move_outbound` 갱신), `004_anon_select_policies.sql` 운영 적용 | — |
| 3 | 1688-invoice | `GET /api/ft/shipment-v2` 확장(box_info_id·size·영문 품목·move_request·master type·manual 조인), box-info PATCH 화이트리스트, 출고 API 요청 자동 닫기 | 2 |
| 4 | 1688-invoice | 쉽먼트 V2 구조 분리 + 디자인 + 카드보드 + 영문/❓ + 사이즈 편집 + 이동요청 버튼 + `/api/ft/move-requests/*` | 3 |
| 5 | 1688-invoice | `POST /api/ft/shipment-v2/manual` + 생성 모달 | 3 |
| 6 | 1688-invoice | `lib/boxLabelPdf.ts` 추출 + 박스라벨 모달 (+ box-label 페이지 회귀 확인) | 4 |
| 7 | purchase-agent | 출고준비: range 교정 · 박스사이즈 · 스캔편집 제거 · 이동요청 모달 · 이동중 배지 (main 브랜치) | 2 |
| 8 | 양쪽 | i18n ko/zh, pageTableMap, `npm run type-check`(1688) / `npm run lint && build`(purchase-agent) | 전체 |

검증(운영 DB, 테스트 사용자 BR 의 미출고 4행으로)
- 요청 생성 → 1688 `[요청]` 카드 1 → 다른 타입 박스로 이동 후 [처리완료] 클릭 시 거절 메시지 → 맞는 타입으로 이동 후 [처리완료] 성공 → 고객 화면 `이동완료` 24h 배지.
- 출고 시 남은 REQUESTED 가 CANCELLED 로 닫히는지.
- 수동 생성 행: 쉽먼트 V2·출고준비·출고 후 출고완료 스냅샷·통관 엑셀에 정상 노출, 진행상황 '전체' 탭·입고 V2·주문상태 V2·장바구니 불러오기에는 미노출. 분할 이동 후 새 행에도 상품정보 유지(`manual_item_id` 복사).
- `ShipmentV2Row.size_code` 는 수동 행이면 `manual_items.size_code`, 아니면 기존 `resolveScanSizeCode` — 쉽먼트에러 판정·카드 집계가 같은 필드를 쓰므로 추가 분기 없음.
- 박스 사이즈 수정 후 export-product-v2 박스 선택 모달에 반영되는지(같은 컬럼).
- 박스라벨: 체크 없음 = 전체, 일부 체크 = 해당 박스만, 합배송 하위 박스 제외 토글.
