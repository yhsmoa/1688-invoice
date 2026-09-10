# 라벨 즉시출력 — Supabase 정리 (다른 프로젝트로 옮길 때)

원본: Supabase 프로젝트 `manage-item` (ref `mkcxpkblohioqboemmah`, ap-northeast-2), `public` 스키마.
2026-09-10 기준. 이 폴더의 SQL 두 개를 순서대로 실행하면 표와 템플릿이 그대로 생긴다.

| 파일 | 내용 |
|---|---|
| `001_label_schema.sql` | 표 3개 + 인덱스 + 체크 제약 (원본과 동일) |
| `002_label_templates_seed.sql` | 템플릿 8종 (아이엠몽/설온 × 스티커/케어 × 성인/키즈, 레이아웃 JSON 포함) |

## 1. 표

### `label_templates` — 라벨 양식
라벨 설정 화면(`/label-settings`)이 편집하고, 입고·라벨 모달의 즉시 출력이 읽는다.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | 템플릿 이름 (한글) |
| `description` | text | 작업자용 설명 (중국어). 드롭다운 두 번째 줄 |
| `label_type` | text | `barcode`(스티커) / `care`(케어라벨) |
| `audiences` | text[] | `adult`(권장연령 없음) / `kids`(있음). 최소 1개, 둘 다 가능 |
| `user_ids` | uuid[] | 쓸 수 있는 사업자 id. `NULL`/빈 배열 = 공용 |
| `printer_lang` | text | 항상 `TSPL2` |
| `width_mm`, `height_mm`, `gap_mm` | numeric | 라벨 크기·틈 |
| `media` | text | `gap` / `continuous` / `blackmark` |
| `cutter` | text | `off` / `each` / `batch` |
| `dpi` | int | 203 / 300 / 600 |
| `density`, `speed` | int / numeric | TSPL DENSITY·SPEED. NULL = 프린터 기본 |
| `layout` | jsonb | 요소 배열. 구조는 `lib/labelTypes.ts` 의 `LabelElement[]` |
| `is_default` | bool | 사업자·종류·대상 조합당 1개 — DB 가 아니라 `/api/label-templates` 가 강제 |
| `created_at`, `updated_at` | timestamptz | |

인덱스: `label_type` btree, `user_ids` GIN. 외래키 없음.

### `label_print_logs` — 인쇄 기록
인쇄 성공 후 `/api/label-print-logs` 가 일괄 insert. 실패해도 인쇄 흐름을 막지 않는다.
`template_id`, `order_item_id` 는 참고용 uuid 이고 FK 가 아니다.

### `label_printers` — (레거시) PC-NO 별 프린터
새 인쇄 경로는 서버가 아니라 **브라우저 localStorage** 에 "템플릿 id → 이 PC 프린터명" 을 저장한다
(`lib/localPrinterMap.ts`, 키 `ls_local_printer_map_v1`). 이 표는 `/api/label-printers` 를 같이 옮길 때만 필요하다.

### RLS
세 표 모두 RLS 꺼짐, 정책 0개, 트리거 0개. 앱은 서버 라우트에서 service-role 키로만 접근한다.
anon 키로 직접 붙일 계획이면 RLS 를 켜고 정책을 따로 만들어야 한다.

## 2. 다른 표에 기대는 것 (새 프로젝트에서 맞춰야 함)

라벨 표 자체는 독립적이지만, 코드가 다음 표의 컬럼을 읽는다.

**사업자 표** (원본 `ft_users`, API `/api/ft/users`)
- `user_ids` 가 이 표의 `id`(uuid) 를 가리킨다.
- 계정 정보 바인딩(`acc_*` 필드)에 쓰는 컬럼: `vender_name`, `full_name`, `username`, `brand`,
  `user_code`, `master_account`, `phone`, `email`, `address`.
- 시드는 `user_ids` 를 `NULL`(공용) 로 넣는다. 새 사업자 id 가 정해지면 채운다.
  원본 배정: `아이엠몽*` → BZ, BR / `설온*` → BO.

```sql
UPDATE public.label_templates SET user_ids = ARRAY['<아이엠몽 uuid>', '<BR uuid>']::uuid[] WHERE name LIKE '아이엠몽%';
UPDATE public.label_templates SET user_ids = ARRAY['<설온 uuid>']::uuid[]                  WHERE name LIKE '설온%';
```

**주문 항목 표** (원본 `ft_order_items`) — 라벨 1장에 바인딩되는 값
`item_name`, `option_name`, `barcode`, `item_no`(→ `product_no`), `shipment_type` + `coupang_shipment_size`(→ 배송 사이즈코드),
`composition`(소재), `recommanded_age`(권장연령 → 성인/키즈 판정), `set_total` + `product_no`(세트 병합).

## 3. 같이 옮겨야 하는 코드

| 구분 | 경로 |
|---|---|
| 타입·렌더·인쇄 | `lib/labelTypes.ts`, `lib/labelRender.ts`, `lib/tspl.ts`, `lib/qzTray.ts`, `lib/localPrinterMap.ts`, `lib/careSymbols.ts`, `lib/sizeCode.ts` |
| API | `app/api/label-templates/route.ts`, `app/api/label-print-logs/route.ts`, `app/api/qz/cert/route.ts`, `app/api/qz/sign/route.ts`, (레거시) `app/api/label-printers/route.ts` |
| 라벨 설정 화면 | `app/label-settings/**` (TopsideMenu · LeftsideMenu · SaveContext 에 의존) |
| 입고·라벨 모달 쪽 | `app/import-product-v2/utils/printLabels.ts`, `hooks/useLabelTemplatePlan.ts`, `components/LabelTemplatePicker.tsx/.css` |
| 글꼴 | `app/layout.tsx` 의 나눔스퀘어 `<link>` (jsDelivr) — 인쇄 PC 에 인터넷 필요 |
| i18n | `locales/ko.json`, `locales/zh.json` 의 `importProduct.processReady.template*` 키 |

npm: `jsbarcode`, `qrcode`(+`@types/qrcode`). QZ Tray 스크립트(`qz-tray@2.2.4`, `js-sha256`)는 CDN 동적 로드.

## 4. 환경변수

| 이름 | 용도 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | 서버 라우트 DB 접근 |
| `QZ_CERTIFICATE` | QZ Tray 허용창 없이 쓰기 위한 공개 인증서 (PEM). `/api/qz/cert` 가 내려준다 |
| `QZ_PRIVATE_KEY` | 위 인증서의 개인키. `/api/qz/sign` 만 사용, 브라우저로 안 나감 |

## 5. 적용 순서

1. `001_label_schema.sql` 실행 (레거시 `label_printers` 블록은 필요 없으면 지워도 된다).
2. `002_label_templates_seed.sql` 실행 → 템플릿 8종.
3. 사업자 표를 만든 뒤 위 `UPDATE` 로 `user_ids` 채우기.
   공용(NULL) 상태로 두면 같은 종류·대상에 기본 템플릿이 2개(아이엠몽/설온)라 자동 선택이 먼저 만들어진 쪽으로 잡힌다.
4. 각 인쇄 PC 에서 `/label-settings` > 프린터 탭에서 템플릿마다 프린터 지정 (PC 별 localStorage).
