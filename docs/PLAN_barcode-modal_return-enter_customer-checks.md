# 작업 계획 — ① 탑메뉴 [BARCODE] 자동 출력 모달 · ② 반품 가격 Enter → 서비스 이동 · ③ 고객 검수 확인 (Notion 대체)

작성일: 2026-10-25 · 상태: **계획 (구현 전, 사용자 결정 대기 — 12장)** · 작성: Fable 5.1
대상 저장소: `1688-invoice` (③ 의 고객 답변 화면은 `purchase-agent` 도 포함 — 12-1 결정에 따름)

> 구현 전에 **12장 결정 사항**에 답을 받는다. 답이 없으면 각 항목의 "기본값"으로 진행한다.
> 세 작업은 서로 독립이라 ② → ① → ③ 순서로 각각 커밋·배포한다 (13장).

---

## 0. 조사 요약 (코드·DB 실측, 2026-10-25, project `mkcxpkblohioqboemmah`)

### 0-1. 라벨·QR 출력 경로 (① 의 토대)

- 라벨 즉시 출력은 `app/import-product-v2/utils/printLabels.ts` 한 곳이다: 세트 병합 → 성인/키즈 템플릿 → **이 PC 의 프린터**(`lib/localPrinterMap.ts`, 브라우저 localStorage) → TSPL → QZ Tray → `label_print_logs` 기록.
- 템플릿 선택은 `hooks/useLabelTemplatePlan.ts` + `components/LabelTemplatePicker.tsx` 가 담당한다. 둘 다 `items` 와 `userId` 만 받으면 어디서든 쓸 수 있다 (V3 가 이미 V2 컴포넌트를 가져다 쓴다).
- **라벨 스티커 템플릿 5종의 바인딩**: QR 요소는 전부 `product_no`, 1D 바코드 요소는 `barcode` (안녕릴리 템플릿만 `product_no`). → 스캐너가 읽어 오는 값은 **product_no 또는 barcode** 두 가지다. item_no 는 글자로만 찍힌다.
- `ft_order_items` 39,473행. 10월 기준 `product_no` 하나당 행 수: 1행 75% · 2행 21% · 3행 2%. 같은 `barcode` 가 여러 행에 있는 경우 193개 (같은 상품을 다른 주문에서 재주문).
- `ft_order_items` 인덱스: PK, `(user_id, created_at)`, `(user_id, status, created_at)`, `(user_id, status, item_no)`. **barcode / product_no 단독 인덱스 없음**.
- `label_print_logs.station_no` 는 **NULL 허용**. `printLabels()` 의 `stationNo: number` 는 코드 타입만 필수다.
- 탑메뉴(`component/TopsideMenu.tsx`)의 [SHIPMENT]·[출퇴근] 은 `Link` 이고, 스타일은 `.barcode-shortcut-btn` / `.attendance-shortcut-btn` (검정 알약). 탑메뉴 문구는 i18n 을 쓰지 않는다.

### 0-2. 반품 화면 인라인 편집 (② 의 토대)

- `app/return-product-v2/ReturnProductV2.tsx`: 가격·배송비·서비스 칸은 클릭 → `startEdit` → `<input autoFocus>` → Enter/blur → `commitEdit`.
- **가격 저장 시 서비스료 6% 자동 계산** (`lib/cancelAmounts.calcServiceFee`) 후 `PATCH price_cny` → `PATCH service_fee` 를 **순차 비동기**로 보낸다. 환불 총액은 DB 트리거가 계산하고 마지막 응답값으로 화면을 확정한다.
- 잠재 경합: 자동 체인의 `PATCH service_fee` 가 끝나기 전에 사용자가 서비스 칸을 직접 저장하면, **자동값이 나중에 도착해 사용자 입력을 덮어쓸 수 있다**. 지금은 사람이 그만큼 빨리 누르지 않아 드러나지 않았지만, ② 로 Enter 직후 서비스 칸이 바로 열리면 **반드시** 드러난다 → 2-3 에서 해결.

### 0-3. 고객확인(Notion) 현재 흐름 (③ 의 토대)

- 호출처 2곳: V2 `ItemCheck.tsx` 와 V3 `ImportV3.tsx` 가 **같은 모달** `V2CustomerConfirmModal.tsx` 를 쓴다. 모달 → `POST /api/notion/customer-confirm` (multipart).
- 보내는 항목 1건의 데이터: `id(order_item_id), item_no, item_name, option_name, china_option1/2, order_no, order_qty, confirm_qty(확인수량), arrival_qty(입고개수), img_url, site_url, size_code(A/B/C/P/X), attributes(한글 라벨 배열: 네크라인·소매·밑단·패턴·소재·색상·기타: …), 첨부 이미지 0~10장(압축본 ~500KB)` + `seller_code(선택 사용자 user_code)`.
- 첨부 이미지는 이미 Supabase Storage 공개 버킷 **`customer-confirm`** 에 올라가고 Notion 은 URL 만 참조한다. → 이미지 저장소는 그대로 쓰면 된다.
- Notion 의 `TYPE(A/B/C/P/X)` 는 MD 문서에서 "의미 확인 필요"로 남아 있는데, 코드상 **배송 사이즈 코드** (`resolveSizeBadge`) 다. 문제 유형이 아니다. → 3-2 컬럼명 `size_code` 로 확정.
- Notion 의 `주문번호` 속성에는 실제로 **item_no** 가 들어간다 (`'주문번호': item_no`). 웹에서는 order_no 와 item_no 를 둘 다 따로 저장한다.
- 팀(`user_code`)은 BZ/BO 만이 아니라 **BZ, BO, BR, HI, MB** 5개 (`ft_users.display_order` 순). 탭은 고정 2개가 아니라 사용자 목록에서 만든다.
- 고객(팀)이 로그인하는 곳은 `purchase-agent` (`ft_users` 로그인, Supabase **anon 키**를 브라우저에서 직접 사용, 관련 `ft_*` 테이블은 RLS 꺼짐). `1688-invoice` 에는 고객 로그인이 없다.

---

## 1. ① 탑메뉴 [BARCODE] — 스캔 → 조회 → 수량 → 출력

### 1-1. 동작

1. 탑메뉴에 **[BARCODE]** 버튼 (SHIPMENT 바로 왼쪽, 같은 검정 알약 스타일, 어느 페이지에서나). 클릭 → 모달.
2. 모달이 열리면 **스캔 입력칸**에 자동 포커스. 스캐너(키보드 입력 + Enter) 또는 직접 타이핑 + Enter.
3. 입력값으로 **조회** → 일치하는 상품 행을 표시: 이미지 · 상품명 · 옵션 · item_no · barcode · 사업자(팀) · 세트 여부.
4. 행마다 **수량** 입력 (결과 1건이면 그 칸으로 포커스 이동, 기본 1). 결과가 여러 건이면 기본 0, 0 보다 큰 행만 출력.
5. 템플릿 선택(`LabelTemplatePicker`, 라벨 스티커) — 그 사업자의 기본 템플릿 자동 선택, 바꿀 수 있음.
6. **[출력]** (수량 칸에서 Enter 도 동일) → `printLabels()` → "N장 전송됨" 표시 → 결과 비우고 스캔 입력칸으로 포커스 복귀 → 다음 스캔.
7. 모달 안에 **이번 세션 출력 기록** 5줄 (시각 · 상품 · 장수) — 두 번 찍었는지 바로 보이게.

### 1-2. 조회 규칙 — 새 API `GET /api/ft/order-items/lookup?code=…`

- `code` 를 공백 제거 후 **`product_no` = code OR `item_no` = code OR `barcode` = code** 한 번에 조회 (대소문자 그대로, 최신 `created_at` 순, 최대 200행). SELECT 는 `lib/ftOrderItemsSelect.ts` 의 `FT_ORDER_ITEMS_DISPLAY_SELECT` 를 그대로 써서 `printLabels` 바인딩에 필요한 컬럼이 빠지지 않게 한다.
- **묶음 규칙**(같은 상품이 여러 주문에 있을 때 한 줄로):
  - 세트(`set_total > 1`) → `product_no` 로 한 줄 (`printLabels` 의 세트 병합과 같은 기준, 대표 행 = 최신 행).
  - 그 외 → `item_no` 로 한 줄 (최신 행 대표). `item_no` 가 없으면 `barcode` 로.
  - 결과가 20줄을 넘으면 20줄까지만 보여 주고 "더 있음" 표시 (barcode 로만 들어왔을 때 재주문이 많은 경우).
- 응답: `{ success, code, matchedBy: 'product_no'|'item_no'|'barcode'|null, rows: FtOrderItem[], users: { [user_id]: FtUser } }`. `users` 는 `/api/ft/users` 와 같은 정제(비밀번호 제외)로 행의 사업자를 함께 내려 준다 — 템플릿 선택과 계정 바인딩(`acc_*`)에 필요.
- 사업자가 서로 다른 행이 섞이면(이론상 barcode 충돌) 사업자별로 **묶어서 각각 출력**한다 — `printLabels` 는 사업자 1명 단위이므로 사업자 그룹마다 한 번씩 호출.

### 1-3. 출력

- `printLabels({ items, selectedUser, brand: user.brand, stationNo: null, labelType: 'barcode', templates: plan.selectedOf('barcode'), printedBy: null })`
- `stationNo` 타입을 `number | null` 로 넓힌다 (기록 컬럼이 NULL 허용). 기존 호출부는 그대로.
- 세트 병합은 기본값(true) 유지 → 세트는 1장.

### 1-4. 엣지 케이스 (전부 처리)

| 상황 | 처리 |
|---|---|
| 일치 없음 | 빨간 안내 "일치하는 상품이 없습니다 (code)", 입력칸 비우고 포커스 유지 |
| 조회 중 Enter 연타 | 조회 중에는 무시 (스캐너 이중 입력 방지) |
| QZ Tray 꺼짐 / 프린터 미지정 / 템플릿 없음 | `printLabels` 의 기존 안내 문구 그대로 표시, 아무것도 찍지 않음 |
| 수량 0 또는 빈 값만 있음 | [출력] 비활성 |
| 결과에 사업자 2명 이상 | 행에 사업자 배지 표시 + 사업자별로 템플릿·출력 분리 |
| 다른 페이지의 숨은 스캔 입력(SHIPMENT 화면 등) | 모달이 열려 있는 동안 포커스는 모달 안 — 영향 없음. Esc 로 닫기 |
| 안녕릴리 스티커의 1D 바코드(=product_no) | `product_no` 매칭으로 자연히 처리 |
| P(개인) 건: 바코드 같고 product_no 가 46개 | barcode 로 스캔하면 최신 20줄 → **QR(product_no) 로 스캔하라는 안내 문구** 표시 |

### 1-5. 변경 파일

- 신규 `component/BarcodePrintModal.tsx` + `.css` (모달), `app/api/ft/order-items/lookup/route.ts`
- 수정 `component/TopsideMenu.tsx` (+ `.css` 버튼), `app/import-product-v2/utils/printLabels.ts` (`stationNo` null 허용), `app/db/database/pageTableMap.ts`
- (선택, 12-5) `supabase/orders/001_ft_order_items_lookup_indexes.sql` — `barcode`, `product_no`, `item_no` 단일 인덱스 3개

---

## 2. ② 반품 — 가격 Enter → 서비스 칸으로 이동

### 2-1. 동작

- 가격 칸에서 **Enter** → 가격 저장(기존과 동일: 서비스 6% 자동 계산·저장 포함) → **같은 행 서비스 칸이 바로 편집 상태로 열리고 자동 계산값이 채워진 채 포커스**. Enter 면 그대로 확정, 숫자를 고치면 고친 값 저장.
- 가격 칸에서 **blur(다른 곳 클릭)** 는 지금처럼 저장만 하고 이동하지 않는다 (사용자가 다른 곳을 눌렀으므로).
- 가격을 비워서 Enter(= null) 하면 이동하지 않는다 (서비스 자동값이 없음).
- 서비스 칸에서 Esc → 편집만 닫힘. DB 에는 자동 체인이 이미 6% 를 저장했고 화면도 같은 값이라 **불일치 없음**.

### 2-2. 변경

- `commitEdit(opts?: { advanceToService?: boolean })` — `handleEditKeyDown` 의 Enter 에서만 `advanceToService: true`. 가격이 숫자일 때 체인 시작 후 `setEditingCell({ id, field: 'service_fee' }); setEditValue(String(fee))`.

### 2-3. 저장 순서 보장 (0-2 의 경합 제거) — 반드시 포함

- 행(id)별 **직렬 저장 큐**: `saveQueueRef: Map<id, Promise<void>>`. 그 행의 모든 PATCH(가격 → 자동 서비스 → 사용자 서비스 → 배송비 …)는 앞 요청이 끝난 뒤 보낸다. 자동 6% 가 사용자 입력을 뒤늦게 덮어쓰는 일이 구조적으로 불가능해진다.
- 화면의 `total_refund_cny` 는 큐의 **마지막 응답값**으로만 확정 (중간 응답이 늦게 와서 되돌리는 일 방지).
- `updateField` 와 가격 체인 둘 다 이 큐를 탄다 — 기존 동작(낙관적 반영 + 실패 시 재조회)은 그대로.

### 2-4. 검증

- 가격 Enter → 서비스 칸 열림·값 채워짐·포커스 → Enter → DB `service_fee` = 6% 값.
- 가격 Enter 직후 서비스 값 즉시 수정 + Enter → 네트워크 지연을 걸어도(DevTools throttle) DB 최종값 = 사용자 값.
- 가격 blur → 이동 없음. 빈 값 Enter → 이동 없음. DONE(정산 잠금) 행 → 편집 불가 그대로.

---

## 3. ③ 고객 검수 확인 — Notion 을 자체 DB·화면으로 대체

### 3-1. 전체 그림

```
[창고: 1688-invoice]                         [고객(팀): purchase-agent]  ← 12-1
 입고 V2/V3 [고객확인] 모달 ──POST──▶ ft_customer_checks (+images, +comments)
                                            │
 '고객 검수 확인' 페이지 (/customer-checks)  │    '검수 확인' 페이지 (/inspections)
   팀별 확인요청 탭 · 답변완료 · 처리완료       │      내 팀 건 목록 → 선택(출고/취소/…) + 코멘트
   상세 패널: 사진·댓글·[재확인요청]·[처리완료]  ◀─┘      → 상태 = 답변완료
```

- Notion 전송은 **중단**하고 같은 모달이 새 API 로 저장한다. 모달 UI 는 바꾸지 않고 **"요청 메모" 입력 1칸만 추가** (MD 의 "색상 확인 부탁드립니다" 같은 첫 댓글용, 선택 입력).
- 이미지는 기존 버킷 `customer-confirm` 그대로, 경로만 `{check_id}/{ts}-{n}.jpg`.

### 3-2. DB — `supabase/inspection/001_customer_checks.sql` (PGlite 시나리오 테스트 후 운영 적용)

```
ft_customer_checks            — 확인요청 1건 (Notion 레코드 1행)
  id uuid PK
  user_id uuid NOT NULL → ft_users(id)        팀(고객 계정)
  team_code text NOT NULL                     user_code 스냅샷 (BZ/BO/BR/HI/MB)
  order_item_id uuid → ft_order_items(id) ON DELETE SET NULL
  order_no, item_no, product_no text          식별자 스냅샷 (주문행이 지워져도 남음)
  item_name, option_name, china_option1, china_option2 text
  img_url, site_url text
  size_code text CHECK (IN A,B,C,P,X) NULL     ← Notion 'TYPE'
  order_qty int, confirm_qty int, arrival_qty int   ← 수량 / 확인수량 / 입고
  attributes text[] NOT NULL DEFAULT '{}'      확인 항목 (네크라인·소매·…·기타: …)
  status text NOT NULL DEFAULT '확인요청' CHECK (IN 확인요청, 재확인요청, 답변완료, 처리완료)
  decision text CHECK (IN 출고, 취소, 재문의, 출고수량변경) NULL
  decision_qty int NULL  CHECK (decision <> '출고수량변경' OR decision_qty IS NOT NULL)   ← MD 8-3 해소
  requested_by text        (Worker 이름, 없으면 NULL)
  answered_at, closed_at timestamptz
  created_at, updated_at timestamptz NOT NULL DEFAULT now()
  INDEX (user_id, status, created_at DESC), (status, created_at DESC), (order_no), (item_no)

ft_customer_check_comments    — 댓글 스레드
  id, check_id → ft_customer_checks ON DELETE CASCADE
  author_role text NOT NULL CHECK (IN warehouse, customer)
  author_name text, body text NOT NULL, created_at
  INDEX (check_id, created_at)

ft_customer_check_images      — 첨부 이미지 (상품 원본 이미지는 checks.img_url)
  id, check_id → … CASCADE, storage_path text NOT NULL, public_url text NOT NULL,
  sort_order int NOT NULL DEFAULT 0, created_at
  INDEX (check_id, sort_order)

함수 customer_check_answer(p_check_id, p_user_id, p_decision, p_decision_qty, p_comment, p_author_name)
  — 고객 답변 (purchase-agent 가 호출). 한 트랜잭션:
    · 건의 user_id = p_user_id 인지 (다른 팀 건 차단)
    · status ∈ {확인요청, 재확인요청} 인지 (답변완료·처리완료 건은 거부)
    · 출고수량변경이면 p_decision_qty > 0 필수
    · decision/decision_qty/answered_at/status='답변완료' 갱신 + 댓글(customer) 1건
  — 오류는 'check: ' 접두사 한글 메시지 (급여 함수와 같은 방식)
```

- `updated_at` 은 `BEFORE UPDATE` 트리거로 자동 갱신.
- RLS: 다른 `ft_*` 테이블과 동일하게 **끔** (purchase-agent 가 anon 키로 읽기 때문). 보안 수준은 기존과 같고, 더 조이는 일은 프로젝트 전체 과제라 이번 범위 밖 — 12-6 참고.

### 3-3. 상태 전이 (API 가 강제)

| 현재 | 누가 | 동작 | 다음 |
|---|---|---|---|
| (등록) | 창고 | 모달 저장 | 확인요청 |
| 확인요청 · 재확인요청 | 고객 | 선택 + 코멘트 (함수) | 답변완료 |
| 답변완료 | 창고 | [재확인요청] (코멘트 필수) | 재확인요청 |
| 확인요청 · 재확인요청 · 답변완료 | 창고 | [처리완료] | 처리완료 |
| 처리완료 | 창고 | [다시 열기] | 재확인요청 |
| 아무 상태 | 창고·고객 | 댓글 추가 | 변화 없음 |

고객의 `재문의` 선택도 답변완료로 들어온다 (창고가 보고 댓글로 답하거나 재확인요청). 상태 값은 Notion 과 동일 한글을 쓴다.

### 3-4. API (1688-invoice, service role)

| Method | Path | 내용 |
|---|---|---|
| POST | `/api/ft/customer-checks` | 모달 저장 (multipart). payload 는 지금 Notion 라우트와 같고 `user_id`, `requested_by`, `memo` 추가. 항목별로 이미지 업로드 → 행 생성 → 이미지 행 → memo 댓글. 한 항목 실패는 그 항목만 실패로 집계 (지금과 같음) |
| GET | `/api/ft/customer-checks?tab=open·answered·done&user_id=&q=&page=&size=50` | 목록 + `counts`(사용자별 open 수, answered 수, done 수 — `head:true` count). 서버 페이지네이션(50) — CLAUDE.md §5 |
| GET | `/api/ft/customer-checks/[id]` | 건 + 댓글 + 이미지 |
| PATCH | `/api/ft/customer-checks/[id]` | `{ action: 'recheck' \| 'close' \| 'reopen', comment?, author_name? }` — 3-3 표 밖의 전이는 409 |
| POST | `/api/ft/customer-checks/[id]/comments` | 창고 댓글 |

- 기존 `/api/notion/customer-confirm` 은 호출처가 사라지면 **삭제** (12-3). `NOTION_*` env 는 그대로 두어도 무해.

### 3-5. 화면 — 1688-invoice `/customer-checks` ("고객 검수 확인", 사이드바 '라벨 설정' 아래)

- 상단: 팀 탭 (`ft_users` display_order 순, 각 탭에 미처리 건수 배지) · [답변완료] · [처리완료] · 검색(주문번호·아이템번호·상품명).
- 목록 표: 팀 배지 · 상태 배지 · 선택 배지 · 주문/아이템번호 · 상품명 (💬 댓글수 · 🖼 이미지수) · 확인수량/입고 · 사이즈코드 · 생성일. 처리완료 탭은 페이지네이션.
- 행 클릭 → **오른쪽 슬라이드 패널** (급여장부 [정리] 패널과 같은 톤): 상품명 · 속성 그리드 · 이미지 띠(상품 원본은 image-proxy, 첨부는 public URL, 클릭 확대) · 댓글 스레드 + 입력 · 상태별 버튼([재확인요청]·[처리완료]·[다시 열기]).
- 디자인: 최근 페이지(급여장부·고객계좌(신))와 같은 zinc 팔레트 + 둥근 카드·알약 배지. Notion 색 규칙(확인요청 노랑·재확인 주황·답변완료 초록·처리완료 회색·선택 출고 초록/취소 빨강/재문의 노랑/수량변경 파랑)은 배지 색으로 그대로 계승.
- i18n: 중국 작업자가 쓰는 화면이므로 `locales/ko.json` + `zh.json` 에 키 추가 (상태·선택 값은 **한글 원문을 키로 번역**, DB 에는 한글 저장).

### 3-6. 화면 — purchase-agent `/inspections` ("검수 확인") — 12-1 에서 확정 시

- 사이드바 항목 + 미답변 건수 배지. 로그인 사용자 `user.id` 로 `ft_customer_checks` 조회 (탭: 확인요청 · 답변완료 · 처리완료).
- 상세: 이미지(상품 원본 / 실물 나란히) · 확인 항목 · 댓글 · **답변 폼**(선택 4종 + 출고수량변경이면 수량 + 코멘트) → `customer_check_answer` RPC → 목록 갱신.
- 같은 Supabase 라 별도 연동 없음. 커밋은 purchase-agent 저장소에 따로.

### 3-7. 모달 변경 (`V2CustomerConfirmModal.tsx`)

- props 에 `userId: string` 추가 (ItemCheck·ImportV3 가 `selectedUser.id` 전달), `requestedBy?: string` (Worker 이름이 있으면).
- "요청 메모" textarea 1개 (카드별이 아니라 **저장 1회당 1개**, 모든 카드에 같은 첫 댓글). 비우면 댓글 없음.
- 전송 대상만 `/api/ft/customer-checks` 로 변경. 성공 메시지는 "저장 N건" (Notion 문구 제거).

### 3-8. 엣지 케이스

| 상황 | 처리 |
|---|---|
| 같은 주문행을 두 번 요청 | 허용하되 상세 패널에 "같은 아이템번호의 다른 요청 n건" 링크 표시 (MD 8-4 의 '관련 주문' 최소 구현) |
| 주문행이 나중에 삭제됨 | `order_item_id` NULL, 스냅샷 컬럼으로 표시는 유지 |
| 이미지 업로드 일부 실패 | 그 항목은 실패 집계, 이미 올라간 파일은 정리(삭제) 후 행 미생성 |
| 고객이 답변완료 건에 다시 답변 | 함수가 409 거부 → "이미 답변된 건입니다" |
| 고객이 다른 팀 건 id 로 호출 | 함수가 거부 |
| 창고가 답변 전에 처리완료 | 허용 (고객 답 없이 종료하는 경우 있음) |
| 목록 1000건 초과 | 서버 페이지네이션 50건 + count 는 head 요청 |
| Notion 기존 데이터 | 12-2 — 기본은 이관하지 않음 (Notion 은 열람용으로 유지) |

### 3-9. 변경 파일

- 신규: `supabase/inspection/001_customer_checks.sql`, `lib/customerChecks.ts`(서버 조회·전이 검증), `app/api/ft/customer-checks/**` (4 라우트), `app/customer-checks/` (page + `CustomerChecks.tsx` + `.css` + `components/`(탭·목록·상세패널·이미지 뷰어) + `hooks/useCustomerChecks.ts`)
- 수정: `V2CustomerConfirmModal.tsx` (+ ItemCheck·ImportV3 의 props), `component/LeftsideMenu.tsx`, `locales/ko.json`·`zh.json`, `pageTableMap.ts`
- 삭제(12-3): `app/api/notion/customer-confirm/route.ts`
- purchase-agent(12-1): `app/inspections/page.tsx` + 컴포넌트, `components/Sidebar.tsx`, `types/database.ts`

---

## 10. 검증 계획

| 작업 | 방법 |
|---|---|
| ① | 로컬 운영 모드에서 모달 열기 → 실제 product_no / barcode / item_no 로 조회 결과·묶음 확인(DB 읽기만). 출력은 QZ Tray 가 없는 환경이라 **`printLabels` 직전까지** 실제 실행하고, QZ 호출은 가로채서 전달되는 TSPL 바이트·장수·프린터명을 검증. 실제 인쇄는 창고 PC 에서 1장 시험 |
| ② | 브라우저에서 Enter 흐름 + 네트워크 지연 상태로 경합 재현 → DB 값 확인 |
| ③ | SQL: PGlite 로 전이·거부 경로 전부(이전 급여 작업과 같은 방식) → 운영 적용 → 롤백 테스트. API: 검증 경로 curl. 화면: 로컬에서 실제 저장 1건(테스트 사용자 없음 → **운영 DB 에 테스트 행 1건 생성 후 삭제** — 12-7 승인 필요) 또는 저장 요청 가로채기로 UI 만 검증 |
| 공통 | `npm run type-check`, `npm run build`, 배포 후 운영 smoke |

---

## 12. 결정 사항 (답이 없으면 기본값으로 진행)

| # | 질문 | 기본값 |
|---|---|---|
| 12-1 | 고객(팀)이 **답변**하는 화면은 어디에? (a) purchase-agent 에 `/inspections` 추가 (고객이 이미 로그인하는 곳) (b) 1688-invoice 만 (고객 화면은 나중) | **(a)** |
| 12-2 | Notion 에 있는 기존 요청 데이터 이관? | **안 함** — Notion 은 열람용으로 남김 (댓글은 CSV 로 안 나옴) |
| 12-3 | `/api/notion/customer-confirm` 삭제 시점 | 모달 전환과 **같은 커밋에서 삭제** (호출처 0) |
| 12-4 | ① 모달에 **케어라벨** 출력 버튼도? | **스티커만** (요청 범위) |
| 12-5 | ① 조회 속도용 `ft_order_items(barcode)`·`(product_no)`·`(item_no)` 인덱스 3개 추가(DDL)? 39k행 정확일치라 없어도 수십 ms | **추가** (행이 계속 늘어남) |
| 12-6 | ③ 테이블 RLS — 기존 `ft_*` 와 같이 끔 vs 켬+정책 | **끔** (purchase-agent anon 구조와 일치; 보안 강화는 별도 과제) |
| 12-7 | ③ 화면 검증을 위해 운영 DB 에 **테스트 요청 1건 생성 후 삭제** 허용? | 허용 안 하면 저장 요청을 가로채서 UI 만 검증 |
| 12-8 | ② Enter 이동 순서 | **가격 → 서비스** (요청대로). 배송비까지 이어서 가려면 "가격 → 배송비 → 서비스" 로 변경 가능 |

---

## 13. 진행 순서 (각각 커밋·배포)

1. **②** 반품 Enter + 저장 큐 — 가장 작고 독립. 커밋 1.
2. **①** lookup API → 모달 → 탑메뉴 연결 → (12-5) 인덱스. 커밋 1~2.
3. **③-A** SQL(PGlite 검증 → 운영 적용) → API → 모달 전환 + Notion 라우트 삭제 → 관리 페이지 + i18n + 메뉴. 커밋 2~3.
4. **③-B** purchase-agent `/inspections` (12-1 (a) 일 때). purchase-agent 저장소 커밋 1.
5. 각 단계 후 type-check·build·배포 smoke.
