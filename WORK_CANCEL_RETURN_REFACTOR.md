# CANCEL / RETURN 분리 리팩토링 — 작업 지시서

> 작성: 2026-04-23 / 갱신: 2026-04-23 (사용자 협의 완료)
> 운영 사이트 작업 — **Phase 별 배포 + 회귀 차단** 우선

---

## 1. 배경

### 1-1. 발견된 버그
**케이스 BO-260417-0057**:
- 주문 10 / 입고 7 / 취소 3 (미입고분 반품 접수) → **출고 가능 4건만 표시 (정답 7)**
- 원인: 모든 CANCEL 을 "재고 차감"으로 처리하는 공식 오류

### 1-2. 근본 원인
현재 `type='CANCEL'` 단일 타입이 **두 가지 다른 사건**을 섞고 있음:
- (A) **주문 취소** — 입고 **전**, 공급사가 못 보냄 → 재고 변동 없음
- (B) **반품 접수** — 입고 **후**, 받았다가 돌려보냄 → 재고 감소

정석 ERP(SAP 등)에서는 두 사건을 별도 트랜잭션 타입으로 분리.

### 1-3. 목표
`ft_fulfillment_inbounds.type` 에 **`CANCEL`** (주문 취소) / **`RETURN`** (반품 접수) 두 타입을 분리. 모든 공식·UI·API 일관성 확보.

---

## 2. 도메인 모델

### 2-1. 두 사건의 본질
> RETURN 과 CANCEL 은 본질적으로 같은 "주문에서 빠지는 처리" — 시점·재고 영향만 다름

| | **CANCEL** (주문 취소) | **RETURN** (반품 접수) |
|---|---|---|
| 시점 | 입고 **전** | 입고 **후** |
| 의미 | 공급사가 못 보냄 | 받은 것 돌려보냄 |
| 재고 영향 | ❌ 없음 (들어온 적 없음) | ✅ 감소 (창고에서 나감) |
| 진행(주문) 차감 | ✅ | ✅ |
| 입고 한도 차감 | ✅ (미입고분 처리) | ❌ (이미 입고된 후 사건) |
| 출고가능 차감 | ❌ | ✅ |
| 입력 한도 | `≤ order_qty - ARRIVAL` | `≤ ARRIVAL - 기존 RETURN` |

### 2-2. 카운트 방식 — raw vs DONE 필터
| 카운트 | 사용처 | 의미 |
|---|---|---|
| **raw** (단순 접수도 카운트) | UI 표시용 (진행 / 입고 한도 / 출고가능) | 사용자 행동 즉시 반영 |
| **DONE 필터** (`ft_cancel_details.status='DONE'` 만) | DB 상태 전환 (PROCESSING ↔ DONE) | 확정된 사건만 — 실수 방지 |

---

## 3. DB 스키마 변경

### 3-1. `ft_fulfillment_inbounds`
- 기존 `type` 허용값: `'ARRIVAL'`, `'CANCEL'`
- **신규 허용값**: `'ARRIVAL'`, `'CANCEL'`, **`'RETURN'`**
- CHECK 제약 있다면 RETURN 추가 (Supabase Studio DDL 확인)

### 3-2. `ft_cancel_details`
- 기존 컬럼 그대로
- **신규 컬럼**: `cancel_type TEXT NOT NULL DEFAULT 'CANCEL'` (값: `'CANCEL'` | `'RETURN'`)
- 항상 `ft_fulfillment_inbounds.type` 와 동기화

> 참고: 테이블명이 `ft_cancel_details` 인데 RETURN 도 들어가는 건 어색하지만 변경 비용 큼 — 그대로 사용.

### 3-3. 마이그레이션
- 기존 `ft_fulfillment_inbounds.type='CANCEL'` 모든 행: **그대로 유지** (= 모두 "주문 취소"로 간주)
- 기존 `ft_cancel_details` 모든 행: `cancel_type='CANCEL'` 자동 채움 (DEFAULT)
- 잘못 분류된 케이스(실은 RETURN이었어야 할 것)는 **운영자 수동 보정** — 발견 시 SQL 로 처리

---

## 4. 공식 재정의 (확정)

### 4-1. 핵심 5개 공식

| # | 항목 | 공식 | 카운트 | 사용처 |
|---|---|---|---|---|
| **①** | **진행** | `order_qty - CANCEL - RETURN - PACKED출고완료` | raw | 메인 테이블 컬럼 (입고 V2 / 주문상태 V2) |
| **②** | **남은수량** | `order_qty - CANCEL_done - RETURN_done - PACKED출고완료` | DONE | `confirmDoneForUser` (PROCESSING → DONE 전환) |
| **③** | **입고 한도** | `order_qty - ARRIVAL - CANCEL` | raw | "작업" 셀 입력 한도 검증 (RETURN 무관) |
| **④** | **출고가능수량** | `ARRIVAL - PACKED출고완료 - RETURN` | raw | `/export-product-v2` |
| **⑤** | **쉽먼트 API available** | ④와 동일 | raw | `/api/ft/shipment-v2` |

### 4-2. 용어 정의
- `ARRIVAL` = `ft_fulfillment_inbounds.type='ARRIVAL'` quantity 합계
- `CANCEL` = `ft_fulfillment_inbounds.type='CANCEL'` quantity 합계 (raw)
- `RETURN` = `ft_fulfillment_inbounds.type='RETURN'` quantity 합계 (raw)
- `CANCEL_done` = 위 + `ft_cancel_details.status='DONE'` 필터 (JOIN 필요)
- `RETURN_done` = 위 + `ft_cancel_details.status='DONE'` 필터 (JOIN 필요)
- `PACKED출고완료` = `ft_fulfillment_outbounds.type='PACKED' AND shipment_id IS NOT NULL` quantity 합계
  - "출고" 정의: 쉽먼트 V2 [출고] 클릭 시점 (PACKED + shipment_id 부여)

### 4-3. 검증 — 사용자 예시
**케이스**: 주문 10, 입고 8, CANCEL 1, RETURN 3 (모두 PENDING 상태, 출고 0)

| 공식 | 결과 | 의미 |
|---|---|---|
| ① 진행 | 10 - 1 - 3 - 0 = **6** | 1 받기 + 5 출고 처리 남음 |
| ② 남은수량 | 10 - 0 - 0 - 0 = **10** | 아직 DONE 된 것 없음 — PROCESSING 유지 |
| ③ 입고 한도 | 10 - 8 - 1 = **1** | 1개 더 입고 가능 |
| ④ 출고가능수량 | 8 - 0 - 3 = **5** | 창고에 남은 5개 출고 가능 |

---

## 5. UI 변경

### 5-1. V2CancelModal (반품/취소 접수 모달)
**경로**: `app/import-product-v2/components/V2CancelModal.tsx`
**사용처**: `/import-product-v2`, `/order-status-v2` 의 [반품] 버튼

#### 변경 사항

**(1) 신규 타입 선택 라디오 (필수, 미선택 기본)**
```
[ ] 주문 취소  [ ] 반품 접수
```
- 선택 안 하면 [저장] 비활성

**(2) 요청자 라디오 — 기본 선택 제거**
```
[ ] 유화무역  [ ] 고객
```
- 현재 `'유화무역'` 자동 선택됨 → **미선택 기본** 으로 변경
- 선택 안 하면 [저장] 비활성

**(3) 입력 한도 검증** (수량 입력 시 즉시 검증)
- **CANCEL 선택 시**: `qty ≤ order_qty - ARRIVAL` (이미 입고된 것은 취소 불가)
- **RETURN 선택 시**: `qty ≤ ARRIVAL - 기존_RETURN` (입고된 것 중 아직 안 돌려보낸 만큼만)
- 초과 시 alert + 저장 차단

**(4) 기타 검증 유지**
- 가격 / 배송비 / 사유 필수 입력 (기존 그대로)

### 5-2. 처리 로그 모달 (FulfillmentLogModal)
**경로**:
- `app/import-product-v2/components/FulfillmentLogModal.tsx`
- `app/order-status-v2/components/FulfillmentLogModal.tsx`

**현재**: `type='CANCEL'` → "취소" 라벨 + "반품 철회" 버튼

**변경 후**:
| type | 라벨 | 철회 버튼 |
|---|---|---|
| CANCEL | "주문 취소" | "주문 취소 철회" |
| RETURN | "반품 접수" | "반품 철회" |

- 시각적 구분 (예: 색상 또는 아이콘)
- 철회 시 정확히 해당 type 처리

### 5-3. 메인 테이블 컬럼 (ItemTableRow)
**결정**: 옵션 A (합산)
- 기존 "취소" 컬럼 한 개 유지
- 표시값 = `CANCEL + RETURN` 합산 raw 카운트

### 5-4. 반품접수 V2 (`/return-product-v2`)
- 테이블에 `cancel_type` 컬럼 표시 (CANCEL / RETURN 구분)
- 검색·필터에 type 추가 (선택 사항)

---

## 6. API 변경

### 6-1. `POST /api/ft/cancel`
**경로**: `app/api/ft/cancel/route.ts`

**Request body 변경**:
```ts
{
  user_id: string,
  operator_name: string,
  items: [
    {
      // 기존 필드 ...
      cancel_type: 'CANCEL' | 'RETURN',  // 신규 필수
      requester: '유화무역' | '고객',     // 기존 — 클라가 명시 필수 (자동 default 제거)
    }
  ]
}
```

**처리**:
- `ft_fulfillment_inbounds.type` ← `cancel_type` (그대로)
- `ft_cancel_details.cancel_type` ← `cancel_type` (동일 값)
- 검증:
  - `cancel_type` 미지정/잘못된 값 → 400 에러
  - `requester` 미지정 → 400 에러
  - 서버측에서도 입력 한도 재검증 (CANCEL ≤ order_qty-ARRIVAL, RETURN ≤ ARRIVAL-기존RETURN)

### 6-2. `DELETE /api/ft/fulfillments` (반품 철회)
**경로**: `app/api/ft/fulfillments/route.ts`

**현재**: `type='CANCEL'` 만 처리
**변경 후**: `type IN ('CANCEL', 'RETURN')` 모두 처리
- 삭제 → ft_cancel_details 연동 삭제 (변경 없음, FK 동일)
- order_items.status 재계산 (남은수량 공식 ②) 시 RETURN_done 도 포함

### 6-3. `POST /api/ft/fulfillments` (조회 모드)
**경로**: `app/api/ft/fulfillments/route.ts`
- INBOUND_TYPES 에 `'RETURN'` 추가
- 응답에 type 그대로 포함

### 6-4. `GET /api/ft/cancel-details`
- 응답에 `cancel_type` 필드 포함

### 6-5. `lib/confirmDone.ts`
- `confirmDoneForUser()` 의 남은수량 공식을 ②번으로 갱신
- CANCEL/RETURN DONE 필터링: `ft_fulfillment_inbounds` ↔ `ft_cancel_details` JOIN 후 status='DONE' 필터
- 페이징 처리 주의 (1000건 limit)

### 6-6. `/api/ft/shipment-v2`
- `available_qty` 공식을 ⑤번으로 갱신

### 6-7. `app/export-product-v2/ExportProduct.tsx` (클라)
- `available_qty` 계산을 ④번으로 갱신

---

## 7. Phase 별 작업 단계

운영 영향 최소화 — Phase 별로 commit + Railway 자동 배포 + 검증 후 다음 진행.

### Phase 1: 백엔드 호환성 — RETURN type 도입 (운영 영향 0)
1. **DB 변경** (Supabase Studio 에서 직접):
   - `ft_fulfillment_inbounds.type` CHECK 제약에 `'RETURN'` 추가
   - `ft_cancel_details` 에 `cancel_type TEXT NOT NULL DEFAULT 'CANCEL'` 컬럼 추가
2. **API**:
   - `POST /api/ft/cancel` — `cancel_type` 받아서 type 분기 (없으면 기본 'CANCEL')
   - `GET /api/ft/cancel-details` — `cancel_type` 응답 포함
   - `POST /api/ft/fulfillments` — INBOUND_TYPES 에 'RETURN' 추가
   - `DELETE /api/ft/fulfillments` — RETURN type 도 처리
3. **검증**: 새 type INSERT/DELETE 가능, 기존 CANCEL 로직 변화 없음

→ 이 단계까지는 화면·공식 변화 없음 (호환성만 확보)

### Phase 2: 공식 수정 (버그 fix) — 가장 중요
1. `app/export-product-v2/ExportProduct.tsx` — `available_qty` 공식 ④로 변경
2. `app/api/ft/shipment-v2/route.ts` — `available_qty` 공식 ⑤로 변경
3. `lib/confirmDone.ts` — 남은수량 공식 ②로 변경 (DONE 필터링 + JOIN)
4. `app/import-product-v2/components/ItemTableRow.tsx` — 진행 공식 ①로 변경
5. `app/order-status-v2/...` — 진행 공식 ①로 변경
6. `app/import-product-v2/ItemCheck.tsx` — 입고 한도 공식 ③으로 변경 (변화 없음, 명확화만)

**검증**:
- BO-260417-0057 케이스 → available 7 표시
- /import-product-v2 진행 컬럼 새 의미로 정상 표시
- 입고 V2 작업 입력 한도 정상

### Phase 3: V2CancelModal 신규 UI
1. 타입 선택 라디오 추가 (주문 취소 / 반품 접수, 미선택 기본)
2. 요청자 기본값 제거 → 미선택 기본
3. 두 라디오 모두 선택해야 저장 활성화
4. 입력 한도 자체 검증 (CANCEL/RETURN 각자)
5. 저장 시 `cancel_type` API 전달

### Phase 4: 처리 로그 모달 구분 표시
- `type='CANCEL'` → "주문 취소" + "주문 취소 철회"
- `type='RETURN'` → "반품 접수" + "반품 철회"
- 색상/아이콘으로 시각 구분

### Phase 5: 반품접수 V2 페이지 (`/return-product-v2`)
- 테이블에 `cancel_type` 컬럼 표시
- (선택) 필터·검색에 type 추가

---

## 8. 검증 체크리스트

### Phase 1 후
- [ ] DB ALTER 정상 (CHECK 제약, 신규 컬럼)
- [ ] 기존 CANCEL 데이터 모두 cancel_type='CANCEL' 자동 채움
- [ ] 기존 V2CancelModal 저장 → 정상 동작 (cancel_type='CANCEL' 자동)
- [ ] 기존 처리 로그 철회 → 정상 동작
- [ ] 다른 모든 페이지 무변화

### Phase 2 후
- [ ] BO-260417-0057 케이스 → /export-product-v2 에서 available 7 표시
- [ ] /import-product-v2 진행 컬럼 새 공식으로 표시 (raw)
- [ ] confirmDoneForUser → DONE 전환 정상 (DONE 필터)
- [ ] /shipment-v2, /shipment-complete-v2 정상

### Phase 3 후
- [ ] V2CancelModal: 타입/요청자 라디오 미선택 기본
- [ ] 두 라디오 선택해야 저장 버튼 활성화
- [ ] CANCEL 입력 한도 초과 시 alert
- [ ] RETURN 입력 한도 초과 시 alert
- [ ] 저장 시 DB 에 정확한 type 들어감

### Phase 4 후
- [ ] 처리 로그에서 CANCEL/RETURN 구분 표시
- [ ] 각 type 철회 정확히 처리

### Phase 5 후
- [ ] /return-product-v2 에서 cancel_type 컬럼 표시

### 회귀
- [ ] V1 페이지 (/import-product, /export-product) 영향 없음
- [ ] 기존 라벨 / 입고 / 출고 플로우 정상

---

## 9. 회귀 위험 영역

| 영역 | 위험도 | 완화 방안 |
|---|---|---|
| 기존 CANCEL 데이터의 의미 변경 | 중 | Phase 1에서 DEFAULT 'CANCEL' 자동 채움, 기존 데이터는 모두 CANCEL 로 간주 |
| confirmDoneForUser 공식 변경 (DONE 필터 + JOIN) | **높음** | Phase 2 별도 배포 + 시나리오별 검증 (PENDING → DONE 전환 시점) |
| 출고 가능 수량 변경 | 중 | BO-260417-0057 케이스로 단위 검증 |
| 진행 컬럼 의미 변경 | 중 | 화면 사용자에게 변경 사항 공지 |
| V1 페이지 영향 | 낮음 | V1 은 별도 utils 사용, 변경 안 함 |

---

## 10. 사용자 결정 사항 (확정)

| # | 결정 |
|---|---|
| 1 | 메인 테이블 "취소" 컬럼: **합산** (CANCEL + RETURN 단일 컬럼) |
| 2 | 마이그레이션: 기존 데이터 모두 `'CANCEL'` 유지, 잘못 분류된 건은 운영자 수동 보정 |
| 3 | 배포 전략: **Phase 별 commit + push** (Railway 자동 배포, 단계별 검증) |
| 4 | 잘못 출고된 데이터 보정: **별도 작업** (필요 시 별도 task) |
| 5 | "출고" 정의: **PACKED + shipment_id 부여 시점** (쉽먼트 V2 [출고] 클릭) |
| 6 | RETURN 의미: 입고 후 돌려보낸 — "다시 안 돌아옴, 취소된 건" |
| 7 | 진행/입고 한도/출고가능: **raw 카운트** (즉시 반영) |
| 8 | 남은수량 (PROCESSING → DONE 전환): **DONE 필터** (보수적) |

---

## 11. CLAUDE.md 규칙 이행

| 규칙 | 적용 |
|---|---|
| #1 시니어 검증 | 8개 사용처 전수 조사, 각 공식 의미 명확화, 사용자와 5라운드 협의 후 확정 |
| #2 구조화 | Phase 단위 작업 분리 — DB → API → UI 책임 분리, 새 파일 신설 X |
| #3 섹션 주석 | 코드 변경 시 신규 type / 공식 변경 사유 주석 |
| #4 정석 처리 | 두 사건을 별도 type 분리 (subtype 우회 X). DEFAULT 컬럼으로 마이그레이션 안전. 입력 한도 자체 검증 |
| #5 1000건 limit | confirmDoneForUser JOIN 시 페이징 유지 |

---

## 12. 작업 착수 전 최종 확인

위 문서대로 Phase 1 부터 진행할 수 있습니다.

확인 사항:
- DB ALTER 는 사용자가 Supabase Studio 에서 직접 수행할지, 아니면 SQL 파일로 만들어 드릴지?
- Phase 1 부터 즉시 시작?

답변 주시면 Phase 1 코드 작업 시작합니다.
