# 작업 계획 — 무역계좌 (`/invoice/trade-account`)

작성일: 2026-09-28 · 개정: 2026-09-28 (통장잔고 기준 모델로 재정리) · 상태: **구현 완료 (2026-09-29)** — 결과는 맨 아래 "9. 구현 결과"

## 한 줄 정의

**통장 하나**로 물류대금(1688 지급)·급여·비용이 모두 나가고 고객 충전이 들어온다. 그래서

> **통장잔고 = 회사자산 + immong 충전금(고객 예치 잔액)**

이 항등식을 모든 행에서 유지하는 장부가 무역계좌다. 고객 원장 행마다 immong 잔액 스냅샷이 남듯, 무역계좌는 **통장잔고 스냅샷**을 함께 남긴다(스냅샷 2개). 매월 손익 = 회사자산의 변화(인출·자본투입 제외).

hilili(후불·가상자산)는 1차에서 **완전히 제외**한다 (미수금으로도 잡지 않음). 사용자가 정리한 뒤 포함 요청 시 5-2 방식으로 넣는다.

---

## 0. 조사 결과 — 지금 무엇이 있고 무엇이 없는가

### 0-1. 현재 무역계좌 페이지는 껍데기다
- `app/invoice/trade-account/page.tsx` 는 **고객계좌(구)** 컴포넌트(`PaymentHistory`)를 제목만 바꿔 재사용한다. 회사 계좌·경비·급여 지급 테이블은 **하나도 없다**. 급여는 `app/hr/payroll` 이 출근기록 × 시급으로 매번 계산만 하고 저장하지 않는다(엑셀 Expense·TAX 열은 수기용, DB 에 없음).

### 0-2. 고객 원장(정본) — 무역계좌의 고객 거래는 여기서 파생된다
| 항목 | 실측 (2026-09-28) |
|---|---|
| `ft_user_transactions` | 74행, 2026-09-01 ~, 그룹 2개 (`ft_balances`: 김덕준/immong **+224,192.35** / 유호성/hilili **−267,111.09**) |
| 카테고리 | `이월`(in 1 / out 1) · `충전`(manual 2, 구원장 이관 1) · `구매`(ft_orders 28, 구원장 이관 33) · `환불`(ft_cancel_details 6, adjustment 2) · `차감` 0건(기능은 있음) |
| 구매 1건 | `amount = item_amount + shipping_fee + service_fee(+other_fee)`, 서비스비 = 상품가 × 6% (`lib/deductParser.ts`) |
| 충전 원화 | `krw_amount` 컬럼은 있으나 **기록 0건** |
| 환불 | 매주 일 21:00 UTC(월요일 아침 KST) pg_cron `settle_weekly_refunds` 가 사업자별 1행 합산. **반품 화면에서 담당자가 1688 판매자가 실제 돌려준 상품가(`price_cny`)와 배송비(`delivery_price_cny`, 돌려줬을 때만)를 입력**하고, 서비스비(`service_fee`)는 상품가 × 6% 로 자동 계산(`ReturnProductV2.tsx:339-355`). 고객 크레딧 `total_refund_cny` = 판매자 환불분 + 서비스비 (DB 트리거 `ft_cancel_details_sync_amounts`). 최근 주간 정산 4건 모두 원장 금액 = Σ판매자분 + Σ서비스비 로 일치 확인. 재계산 차액은 `adjustment` 행 |
| 기록 경로 | DB 함수 3개(충전/차감 · 1688 엑셀 차감 · 환불 추가). balance 별 advisory lock, 참조키 중복 차단, `balance_snapshot` 체인, `created_at = clock_timestamp()`. 삭제 없음, `applied_date` 만 수정 |
| 구 원장 | 2025-09 ~ 2026-09-12. 읽기 전용 잠금. 8/31 이전분은 신 원장 이월 행에 합계만 → 신 원장엔 9/1 이전 거래별 이력 없음 |
| 외부 소비자 | purchase-agent 가 `ft_user_transactions`·`ft_balances` 를 브라우저에서 **직접** 읽음 (RLS 꺼짐) |

### 0-3. 급여 — 위안 시급
- `hourly_wage` 18~35 위안/시간, `기업` 역할 1명은 0. 월 근무분 62,610~76,020 → 급여 월 2.3만~2.8만 위안 규모.
- 예상 급여 = `floor(시급 × 분 / 60)` — `Payroll.tsx` `calcWage`, `payroll/export-excel` 에 같은 식이 복제돼 있음.

### 0-4. 접근 제어
- `계좌관리` 메뉴 3페이지는 접근 코드 없이 열린다. DB 관리(`DbAccessGate` + `guardDbRoute`, 역할 `기업`)·급여장부만 잠겨 있다.

### 0-5. Supabase 보안 경고 (범위 밖)
`ft_user_transactions`, `ft_balances`, `ft_order_items` 등 **23개 테이블 RLS 꺼짐**. purchase-agent 가 직접 읽는 테이블이라 정책 없이 켜면 그 앱이 멈춘다 → 별도 작업(8절).

---

## 1. 모델 — 행마다 세 잔액이 어떻게 움직이는가

무역계좌의 모든 행은 세 잔액에 대한 변화량(Δ)을 가진다.

| 사건 | 통장잔고 | immong 충전금 | 회사자산 | 손익 |
|---|---|---|---|---|
| 고객 충전 A | **+A** | +A | 0 | — |
| 1688 구매 차감 (상품 I + 배송 S + 서비스 F) | **−(I+S)** 1688 에 지급 | −(I+S+F) | **+F** | 수익 F |
| 수동 차감 (공임비·포장재 등, 1688 주문번호 없음) | 0 | −A | **+A** | 수익 A |
| 고객 환불 (매주 월) — 판매자 환불분 P(상품가+돌려준 배송비) + 서비스비 F′ | **+P** 판매자가 돌려준 돈 | +(P+F′) | **−F′** | 수익 취소 F′ (구매 때 잡은 6% 를 되돌림) |
| 급여 / 전기세 / 경비 E | **−E** | 0 | −E | 비용 E |
| 대표 인출 W / 자본투입 C | −W / +C | 0 | −W / +C | 없음 (자본 거래) |
| 환차·보정 D | ±D | 0 | ±D | ±D |
| 고객 원장 `이월` 행 | 0 | 0 | 0 | — (장부 전환 행, 현금 이동 아님) |

- 항등식 **통장 = 자산 + 충전금** 은 모든 행에서 Δ통장 = Δ자산 + Δ충전금 이므로 자동 유지된다. 화면은 세 잔액을 나란히 보여주고, 어긋나면 빨간 경고(고객 원장의 합산≠스냅샷 경고와 같은 태도).
- **월 손익 = 그 달 Δ회사자산 − (인출·자본투입)** = 서비스비 수익 − 환불된 서비스비 + 청구수익 − 급여 − 경비 ± 환차.
- **환불은 회사에 손실이 없다.** 고객에게 돌려주는 돈 = 판매자가 실제 돌려준 돈(배송비가 포함됐으면 포함) + 그 상품가에 대해 받았던 6%. 판매자분은 통장에 들어온 돈을 그대로 넘기는 것이고, 6% 는 구매 때 수익으로 잡았던 것을 되돌리는 것이라 두 사건을 합치면 0 이다. 그래서 환불 행의 손익은 **−F′ 하나**뿐이고, 이는 그 주문의 구매 행에서 잡았던 +F 의 일부를 지운다.
- **어려운 부분은 시점**이다. 판매자 환불은 건마다 다른 날 통장에 들어오지만, 원장에는 월요일에 한 번에 잡힌다. 무역계좌는 원장의 월요일 행에 맞춰 통장 +P 를 기록하므로, 그 주 안에서는 실제 통장과 최대 P 만큼 차이가 났다가 월요일에 맞춰진다. 월 단위에서는 무시할 수 있는 수준이고, 통장 내역과 대조해 차이가 있으면 `보정` 행으로 맞춘다. P 와 F′ 의 분해는 원장 환불 행의 `source_ids` → `ft_cancel_details` 에서 정확히 나온다(2-3).

---

## 2. 데이터 설계 — 통장 스냅샷을 기록으로 남긴다

### 2-1. 원칙
1. 고객 거래의 **입력 정본은 그대로 고객 원장**이다. 무역계좌는 고객 원장 INSERT 에 **DB 트리거로 자동 미러링**되어, 사람이 두 번 입력하지 않는다.
2. 미러링된 행은 통장·충전금·자산 세 스냅샷을 **저장**한다(사용자 요구: 스냅샷 2개가 기록으로 남아야 함). 계산만 하고 버리지 않는다.
3. 회사 고유 거래(이월·급여·경비·인출·1688 환불 입금·환차·보정)만 사람이 무역계좌에서 입력한다.
4. 고객 원장과 같은 규율: DB 함수로만 기록, 단일 advisory lock, 참조키 중복 차단, **삭제 금지(취소는 반대 행)**, 미래 날짜 금지, `service_role` 전용.

### 2-2. `ft_trade_transactions` — `supabase/trade/001_trade_ledger.sql`

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | uuid PK | |
| `created_at` | timestamptz | 체인 순서 (`clock_timestamp()`, lock 획득 후) |
| `applied_date` | date | 적용일 (일/월 귀속) |
| `kind` | text | `customer`(미러) / `company`(직접 입력) / `opening` / `reversal` |
| `category` | text | 미러: `충전`·`구매`·`차감`·`환불` / 직접: `급여`·`전기세`·`수도가스`·`임대료`·`통신비`·`소모품`·`물류비`·`세금수수료`·`기타경비`·`인출`·`자본투입`·`환차`·`보정`·`이월` |
| `bank_delta` | numeric | 통장 변화 (부호 포함) |
| `customer_delta` | numeric | immong 충전금 변화 (부호 포함, 회사 행은 0) |
| `asset_delta` | numeric | 회사자산 변화 = bank − customer |
| `bank_balance` | numeric | 이 행 직후 통장잔고 (스냅샷 1) |
| `customer_balance` | numeric | 이 행 직후 immong 잔액 (스냅샷 2, 미러 행은 고객 원장 `balance_snapshot` 복사) |
| `asset_balance` | numeric | 이 행 직후 회사자산 |
| `pnl_delta` | numeric | 손익 반영액 (인출·자본투입·충전·이월은 0) |
| `amount` | numeric | 표시용 절대 금액 |
| `krw_amount` | numeric null | 원화 실제 금액 |
| `description` | text | |
| `reference_id` | text unique | 중복 차단 키 (미러: `UTX-{user_tx_id}`, 급여: `PAYROLL-YYYYMM-{employee_id}`, 취소: `REV-{원본id}`) |
| `user_tx_id` | uuid null unique | 미러 원본 (`ft_user_transactions.id`) |
| `balance_id` | uuid null | 미러 원본의 고객 그룹 (1차는 immong 만) |
| `reverses_id` | uuid null | 취소 대상 |
| `employee_id`, `payroll_month`, `expected_amount` | | 급여 행 |
| `admin_note`, `created_by` | | |

RLS 켜고 정책 없음. 함수는 `REVOKE … FROM anon, authenticated`.

### 2-3. 미러링 트리거 — `ft_user_transactions` AFTER INSERT
- 대상: `balance_id` = immong 그룹(1차, 설정 테이블 `ft_trade_settings(balance_id, started_at)` 로 지정 — 코드에 UUID 하드코딩 금지).
- `category='이월'` → 무시. 그 외는 1절 표대로 Δ 계산:
  - `충전` → bank +amount, customer +amount
  - `구매` → bank −(item+ship), customer −amount, pnl +service_fee(+other_fee 는 [결정 D])
  - `차감` → `order_no_1688` 있으면 구매와 동일, 없으면 bank 0, customer −amount, pnl +amount
  - `환불` → `source_ids` 로 `ft_cancel_details` 를 읽어 **P = Σ(price_cny + delivery_price_cny), F′ = Σ service_fee** 를 구한다. bank +P, customer +amount, pnl −F′. 검증: P + F′ = amount 가 아니면(예: 전환일 이전 규칙으로 price 만 잡힌 행) 예외로 중단 — 임의 비율로 나누지 않는다. `source_ids` 가 `ft_cancel_details` 를 가리키지 않는 행(`adjustment`)은 **전액 판매자분(P = amount, F′ = 0)** 으로 잡고 `admin_note` 에 "분해 불가" 를 남겨 화면에 ⚠ 표시 — 현재 있는 adjustment 2건은 이월 시각 이전이라 대상이 아니고, 앞으로의 정산 행은 모두 정확히 분해된다
- 트리거는 `trade_append_row()` 함수를 호출: 무역계좌 lock 획득 → 직전 행 스냅샷 → 새 스냅샷 → INSERT. 고객 원장 함수가 balance lock 을 이미 잡은 뒤 trade lock 을 잡고, 회사 행 기록은 trade lock 만 잡는다 → **lock 순서가 항상 balance → trade** 라 교착 없음.
- **무역계좌 이월 행이 없으면 트리거는 예외를 던져 고객 원장 기록도 실패**시킨다? → 아니다. 고객 업무를 무역계좌 준비 상태에 묶으면 안 된다. 트리거는 `ft_trade_settings.started_at` 이 있고 `NEW.created_at >= started_at` 일 때만 동작하고, 그 전에는 아무것도 하지 않는다. 이월 입력 시 `started_at` 이 함께 설정된다.
- 트리거 내부 오류(예: 스냅샷 없음)는 고객 원장 트랜잭션 전체를 롤백한다 — 두 장부가 어긋난 채 남는 것보다 낫다. 오류 메시지는 `friendlyRpcError` 에 추가해 화면에 원인이 보이게 한다.

### 2-4. 이월 — 사용자가 알려준 **현재 통장잔고**로 시작
- `trade_open(p_bank_balance, p_at timestamptz)`: `ft_trade_settings.started_at = p_at`, 이월 행 1건 (`bank_balance = p_bank_balance`, `customer_balance = 그 시각 immong 스냅샷`, `asset_balance = bank − customer`). 이월은 1건만 허용.
- 그 시각 이전 고객 원장 행은 미러링하지 않는다 — 이미 잔고에 녹아 있다. 이후 행부터 트리거가 미러링.
- `started_at` 이후에 기록되지만 `applied_date` 가 그 전인 행(수동 충전 날짜 소급, 엑셀 차감은 항상 당일)은 **미러링한다** — 통장 체인은 기록 시각 기준, 월 귀속은 `applied_date`. 5절 #7.

### 2-5. 기타 함수 — `supabase/trade/002_trade_functions.sql`
| 함수 | 역할 |
|---|---|
| `trade_open(...)` | 이월 (1회) |
| `trade_record(p_rows jsonb)` | 급여·경비·인출·자본투입·환차·보정. 참조키 중복·미래 날짜 거절 |
| `trade_record_payroll(p_month, p_paid_date, p_rows)` | 직원별 급여 한 트랜잭션. `PAYROLL-YYYYMM-{employee}` 중복 차단 |
| `trade_reverse(p_id, p_reason)` | 취소 = 반대 Δ 행. 미러 행은 취소 불가(고객 원장에서 다뤄야 함), 이미 취소된 행 거절 |
| `trade_pnl(p_unit, p_from, p_to)` | 일/월별: 거래액·서비스비 수익·환불된 서비스비·청구수익·급여·공과금·기타경비·환차·순이익·이익률·기말 세 잔고 |

정합 검사(화면·API 양쪽): 마지막 행 `bank_balance − customer_balance = asset_balance`, `customer_balance` = `ft_balances`(immong) 현재값, `Σ bank_delta + 이월 = bank_balance`.

---

## 3. 회사 행 입력

### 3-1. 급여
[급여 반영] → 월 선택 → 서버가 `lib/payrollCalc.ts`(급여장부·엑셀과 **같은 함수**로 추출)로 직원별 예상액 → 미리보기(실지급액 편집, 기본 = 예상액, 지급일) → `trade_record_payroll`. 시급 0·근무 0 제외, 퇴사자는 그 달 기록 있으면 포함. 이미 기록된 직원은 잠금.

### 3-2. 경비·인출·자본투입·환차·보정
모달: 적용일 · 구분(카테고리) · 금액(위안) · 원화(선택) · 내용 · 비고. 인출·자본투입은 손익 0. `보정` 은 통장 실잔고와 장부가 어긋났을 때(환불 입금 시점 차이, 1688 부분 결제 등) 맞추는 용도로, 사유를 필수 입력.

---

## 4. 화면 — `app/invoice/trade-account/`

```
page.tsx                      ← DbAccessGate [결정 G]
TradeAccount.tsx / .css       ← 탭 셸 + 요약 카드
components/LedgerTab.tsx      ← 통합 내역 (세 잔액 열)
components/PnlTab.tsx         ← 일별/월별 손익
components/ExpenseModal.tsx   ← 경비·인출·자본투입·환차·보정
components/PayrollModal.tsx   ← 급여 반영
components/OpeningModal.tsx   ← 이월 (통장잔고 입력, 1회)
hooks/useTradeLedger.ts, hooks/useTradePnl.ts
```

- **요약 카드**: 통장잔고 · immong 충전금 · 회사자산 · 정합 배지(✓ / ⚠) · 원화 환산(참고).
- **[계좌내역]**: 기간·구분 필터 · 표: 적용일 | 구분 | 내용 | 통장 입금 | 통장 출금 | **통장잔고** | 충전금 Δ | **immong 잔액** | 회사자산 | 손익 | 참조. 미러 행은 "고객원장" 배지, 회사 행은 [취소].
- **[손익]**: 일/월 · 표 1절 항목 + 이익률([결정 C]) + 기말 통장/충전금/자산.
- **API** (`app/api/trade-account/*`, 전부 `guardDbRoute`): `GET ledger` · `GET pnl` · `POST open` · `POST transactions` · `POST reverse` · `GET payroll/preview` · `POST payroll/commit`.

---

## 5. 예외·엣지 케이스

### 5-1. 데이터·계산
| # | 상황 | 처리 |
|---|---|---|
| 1 | 환불 = 판매자 환불분 + 서비스비 | 판매자분은 통장 +, 서비스비는 수익 취소. `source_ids` 로 정확히 분해, 합이 안 맞으면 중단 (2-3) |
| 2 | 환불 `adjustment` 행 (분해 불가) | 전액 판매자분 + ⚠ 표시. 현재 2건은 이월 이전이라 해당 없음 |
| 3 | 고객 원장 `이월` 행 | 미러링 제외 |
| 4 | 9/1~9/12 구 원장 이관 구매 | item/ship/svc 분해 있음 — 단 이월 시각 이전이라 미러링 대상 아님 |
| 5 | 충전 `krw_amount` 없음 (현재 전부) | 환차 0, "원화 미기록 n건" 표시. 충전 모달에서 원화 입력 권장 |
| 6 | 실제 1688 지급액 ≠ 상품가+배송비 | `보정` 행 |
| 7 | `applied_date` 소급 행 | 통장 체인은 기록 시각, 월 귀속은 적용일. 소급 행은 계좌내역에서 "기록 {created_at}" 툴팁 |
| 8 | 고객 원장 적용일 수정 | 미러 행 `applied_date` 도 같이 바뀌어야 함 → **AFTER UPDATE OF applied_date 트리거**로 동기화 (금액·체인은 불변) |
| 9 | 급여 기록 후 출근기록 수정 | 실지급액 유지, `expected_amount` 와 현재 계산값 다르면 ⚠ |
| 10 | 같은 달 급여 재반영 | 참조키로 거절, 누락 직원만 추가 허용 |
| 11 | 회사 행 삭제 | 없음. `trade_reverse` |
| 12 | 미러 행 취소 요청 | 불가 — 고객 원장에서 반대 거래(충전/차감)로 처리하면 자동 미러됨 |
| 13 | 이월 전 조회 | 잔고 계산 안 함, 이월 입력 유도 |
| 14 | 동시 기록 | 단일 trade lock, balance → trade 순서 고정 |
| 15 | 미래 적용일 | 거절 |
| 16 | 판매자 환불 입금 시점 ≠ 월요일 정산 | 통장 스냅샷은 월요일 행에서 맞춰짐. 그 주 안의 차이는 안내문에 명시, 통장 대조 후 필요하면 `보정` |
| 22 | 반품 화면에서 환불 금액을 정산 **뒤에** 수정 | `ft_cancel_details_settled_guard` 트리거가 이미 차단 → 정산된 행의 P·F′ 는 불변. 미러 행도 불변 |
| 17 | 구 원장 기간 손익 | 신 원장에 이력 없음 → 표시 안 함 (1차). 구 원장 서비스비 합 참고 표시는 [결정 H] |
| 18 | 트리거 실패 | 고객 기록도 롤백, 메시지를 화면에 노출 (`friendlyRpcError`) |
| 19 | purchase-agent | 새 테이블 안 읽음. 고객 원장 스키마 변경 없음(트리거만 추가) |
| 20 | API 직접 호출 | `guardDbRoute` |
| 21 | 기존 무역계좌 URL | 구 원장 화면 사라짐. 고객계좌(구) 메뉴로 동일 내용 조회 가능 |

### 5-2. hilili — 1차 완전 제외, 나중에 포함하는 방법
- 트리거는 `ft_trade_settings` 에 등록된 그룹(1차: immong)만 미러링한다. hilili 행은 아무것도 남기지 않는다.
- 나중에 포함할 때: 설정에 hilili 를 추가하고 **그 시점부터** 미러링한다. 과거 hilili 거래를 소급하려면 스냅샷 체인을 다시 계산해야 하므로(저장된 스냅샷은 불변), 소급이 필요하면 이월을 다시 잡는 방식(현재 통장잔고로 `trade_open` 재설정)으로 한다.
- 그 전까지 hilili 의 1688 결제가 같은 통장에서 나간다면 통장 스냅샷은 그만큼 실제보다 크게 표시된다. 화면 안내문에 "hilili 제외" 를 명시하고, 사용자가 정리를 마치면 포함한다.

---

## 6. 결정 필요 사항

| # | 항목 | 제안 |
|---|---|---|
| A | 통화 | 위안 단일. 원화는 `krw_amount` 참고·환차만 |
| B | 이월 | 사용자가 알려주는 **현재 통장잔고**와 그 시각으로 `trade_open`. 그 이전 행은 미러링 안 함 |
| C | 이익률 분모 | 거래액(고객 차감 총액) 기본, 매출(수익 합) 병기 |
| D | 구매의 `other_fee`(기타비용) | 서비스비처럼 수익으로 (현재 엑셀 차감은 항상 0) |
| E | 급여 반영 | 월 1회, 직원별 실지급액 확인 후 기록 |
| F | 경비 카테고리 | 2-2 목록 |
| G | 접근 제어 | DB 관리 코드(역할 `기업`) 재사용 |
| H | 구 원장 기간 수익 참고 표시 | 1차 제외 |
| I | 인출·자본투입 | 포함 (손익 제외) |
| J | hilili | 1차 완전 제외 (확정). 포함 시점에 5-2 방식 |

---

## 7. 작업 순서
1. `supabase/trade/001` 테이블·설정·RLS → `002` 함수·트리거 → 운영 적용 (기존 테이블은 트리거 추가만)
2. `lib/payrollCalc.ts` 추출, 급여장부 API·엑셀 API 교체 (결과 동일 확인)
3. `lib/tradeLedger.ts` 타입·규칙 + API 7개
4. 화면: 셸 → 이월 모달 → 계좌내역 → 손익 → 경비 모달 → 급여 모달
5. `page.tsx` 를 `DbAccessGate` 로 교체, `pageTableMap.ts` 갱신
6. 검증: 테스트 balance 로 충전·구매·환불 INSERT → 미러 행·세 스냅샷·항등식 확인 → 환불 행에서 P + F′ = amount, 구매 +F 와 환불 −F′ 가 손익에서 상쇄되는지 → 급여 중복 거절 → 취소 행 → 적용일 수정 동기화 → `npm run type-check`
7. 운영 이월: 사용자 통장잔고 입력 → 이후 첫 고객 거래에서 정합 배지 ✓ 확인

## 8. 범위 밖
- RLS 꺼진 23개 테이블(0-5) — purchase-agent 읽기 정책과 함께 별도 작업.
- hilili 포함 (5-2) — 사용자 정리 후.

---

## 9. 구현 결과 (2026-09-29)

### 운영 DB 적용 (mkcxpkblohioqboemmah)
| 항목 | 내용 |
|---|---|
| 마이그레이션 `ft_trade_ledger` | `ft_trade_settings` · `ft_trade_groups` · `ft_trade_transactions`(RLS, 정책 없음) + 함수 7개 + 고객 원장 트리거 2개 — `supabase/trade/001_trade_ledger.sql` |
| 이월 | `trade_open(393507.83, immong)` 2026-09-29 15:04 KST — 통장 393,507.83 / 충전금 192,248.16 / **회사자산 201,259.67**. 이 시각 이후 immong 고객 거래부터 자동 미러링 |
| 권한 | 기록·집계 함수는 `service_role` 전용. 트리거 함수는 `SECURITY DEFINER` → purchase-agent(authenticated)가 고객 원장에 기록해도 미러링됨 |

### 계획과 달라진 점
- **미러링 판정은 `created_at` 이 아니라 커밋 순서**: `deduct_balance_and_record_transaction_v2` 는 `created_at = now()`(트랜잭션 시작 시각)라, 이월 직전에 시작해 lock 을 기다리던 거래가 시각 비교로는 빠질 수 있다. `trade_open` 이 balance lock 을 먼저 잡고 스냅샷을 읽으므로, 그 뒤에 커밋되는 행은 전부 미러링한다. `included_from` 은 기록용.
- **환불 분해는 `refund_cny` 규칙을 그대로 따른다**: 전환일 이전 완료건(price 만 환불)이 섞여도 Σ = amount 가 맞게 P/F′ 를 나눈다. 안 맞으면 예외.
- **고객 잔액 불연속은 막지 않는다**: 미러 행의 충전금 스냅샷은 고객 원장 값이 정본. 기대 Δ 와 다르면 `admin_note` 에 경고를 남기고 자산이 차이를 흡수 (항등식 유지).
- `trade_pnl` 은 이월 행을 제외하고 집계, 기말 잔고는 기간 마지막 행 스냅샷.
- 급여 계산을 `lib/payrollCalc.ts` 로 추출해 급여장부 API·엑셀 API·무역계좌가 공유 (급여장부 응답 형식 동일 확인: 9월 9명 / 166행 / 30일).
- `DbAccessGate` 에 `title` prop 추가(기본값 유지), `lib/dbAccess.ts` 에 `requireDbAccess`(직원 id 반환) 추가 — 기존 3개 라우트 영향 없음.

### 검증 (롤백 트랜잭션, 운영 데이터 무변경)
이월 전 삽입 → 미러 0 / 이월 / 충전·구매·차감·환불(실제 DONE 3건, P=86.00 F′=4.68) 미러 Δ·스냅샷 / hilili 행 미러 0 / 보정 사유 필수·참조키 중복·미래 날짜·급여 중복·재취소·미러 행 취소 거절 / 적용일 수정 동기화 / 최종 항등식·Σ통장Δ=잔고·충전금=고객원장 / 손익 net = 110 − 4.68 − 5500 (전기세 취소분 상쇄) 모두 통과. 롤백 후 잔여 0행 확인.
API: 접근 코드 없이 8개 라우트 모두 401, 잘못된 코드 401. `npm run type-check` 통과.

### 화면 확인 한계
`/invoice/trade-account` 는 DB 관리 접근 코드(역할 `기업`)가 필요해 잠금 화면(제목 "무역계좌")까지만 확인했다. 해제 후 화면(요약 카드·계좌내역·손익·모달)은 코드 리뷰와 API 검증으로 대신했으므로 첫 사용 시 확인 필요.

### 추가 (2026-09-29 오후) — 환불예정 · 통장 대조
- **환불예정 카드**: 정산 전 반품·취소(완료/처리중/접수)를 집계(`trade_pending_refunds`, `supabase/trade/002_*.sql`). 판매자 환불분은 통장으로 들어와 고객에게 그대로 넘어가므로 자산과 무관하고, **서비스비만 자산에서 빠질 예정** → "예정 결과(조정 자산) = 회사자산 − 환불예정 서비스비". 장부에는 기록하지 않는다(금액 미확정, 장부는 일어난 일만).
  2026-09-29 immong: 완료 37건(서비스비 67.93) · 처리중 138건(634.96) · 접수 33건 · 판매자분 합 12,090.87.
- **통장 대조**(매주): 실제 통장잔고 입력 → 장부와 차이 → 선택적으로 `보정` 행(손익 반영). 이력은 `ft_trade_bank_checks`. 7일 넘게 대조가 없으면 버튼·카드에 경고.
  첫 대조 때 예상되는 차이: 이월(393,507.83)에 이미 들어 있던 판매자 환불분이 월요일 정산에서 다시 통장 + 로 미러링되는 만큼. 그 금액을 '이월 전 입금된 판매자 환불분' 사유로 보정하면 이후 주부터는 맞아야 한다.

### 첫 사용 안내
1. 무역계좌 접속 → DB 관리 코드 입력 → 요약 카드에 통장 393,507.83 / 충전금 / 자산 / 정합 ✓ 확인
2. 이후 고객계좌(신)에서 충전·차감·1688 주문을 기록하면 [계좌내역]에 "고객원장" 배지로 자동 등장
3. 월요일 환불 정산 후 환불 행이 판매자분(통장 +)·서비스비(자산 −)로 나뉘어 들어오는지 확인
4. [급여 반영]으로 9월 급여 기록 → [손익] 탭에서 순이익·이익률 확인
5. 매주(월요일 정산 이후 권장) [통장 대조]로 실제 잔고 입력 → 차이가 있으면 사유와 함께 보정
