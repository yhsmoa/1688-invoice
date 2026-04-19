# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 작업 규칙 (필수 준수)

이 프로젝트는 **현재 운영 중인 사이트**이므로 아래 다섯 가지 기준을 모든 작업에 무조건 적용한다.

1. **시니어 개발자 기준으로 정확히 스크립트를 확인 후 진행**
   - 요청받은 파일과 그 호출 관계(부르는 쪽·불리는 쪽·데이터 흐름)를 끝까지 읽고 엣지 케이스까지 짚은 뒤 작업한다.
   - "일반 케이스는 동작함" 수준에서 멈추지 않는다. 변경으로 인한 영향 범위를 항상 확인한다.

2. **구조화가 필요한 부분은 구조화한다**
   - 한 파일·한 함수에 기능을 계속 쌓지 않는다. 페이지 컴포넌트가 비대해지면 `components/<feature>/`, `hooks/use*.ts`, `utils/` 서브폴더로 분리한다.
   - 기준 패턴: `app/import-product-v2/` (`ItemCheck.tsx` + `components/` + `hooks/useFtData.ts` + `utils/saveLabelData.ts`).

3. **섹션 단위 주석 유지**
   - 코드를 시각적 블록으로 나눈다. 기준 스타일:
     - TS/TSX: `// ============================================================` 로 구획 + `// ── 소제목 ──` 로 소단락
     - CSS: `/* ============================================================ */` 로 구획
   - 예시 파일: `component/SaveResultModal.tsx`, `component/SaveResultModal.css`, `app/import-product-v2/ItemCheck.tsx`, `app/api/save-fashion-label/route.ts`.

4. **임시방편·하드코딩 금지 — 반드시 정석 방식으로**
   - 매직 넘버, 테스트용 고정 ID, "일단 돌아가게" 우회 금지. 운영 환경에서 그대로 문제가 된다.
   - 설정값은 env로, 담당자 식별은 `/api/hr/workers` + PC-NO 드롭박스로(과거 하드코딩 `OPERATOR_ID_MAP` 제거됨, 커밋 `b7c7ff2` 참조).
   - 지름길이 필요하면 코드에 몰래 넣지 말고, 근거와 함께 사용자에게 먼저 확인받는다.

5. **Supabase 1000건 limit 대응 필수**
   - Supabase PostgREST 기본 응답 제한은 **1000행**이다. 조회·수정·일괄 작업 스크립트 작성 전에 **해당 테이블의 현재 건수를 반드시 확인**한다. 건수를 모른 채로 구현하지 않는다.
   - 전체 데이터 순회가 필요한 모든 작업은 `.range(from, from + 999)` 페이지네이션 루프로 처리한다.
   - 기준 구현: `fetchAll` helper in `lib/confirmDone.ts`. 새 경로에서도 이 패턴을 재사용하거나 동일한 루프 구조를 복제한다.
   - 건수가 수만 건 이상일 가능성이 있으면 배치 크기·타임아웃·중간 저장 전략을 먼저 협의한 뒤 진행한다.

## Commands

```bash
npm run dev          # Dev server (binds 0.0.0.0, accessible on LAN)
npm run build        # Next.js production build
npm run start        # Production server (0.0.0.0)
npm run type-check   # tsc --noEmit (verify types without emitting)
```

There is no test runner and no lint command. `type-check` is the primary pre-commit verification. Also see `start-server.bat` / `start-server.ps1` / `start-server.vbs` — Windows shortcuts for running `npm run dev`.

## Architecture

Next.js 14 App Router + TypeScript. Operates a Korean/Chinese bilingual **Coupang/1688 invoice & fulfillment management system** used in production by warehouse workers. Pages are heavy React client components (`'use client'`), not server components.

### Data stores (three systems, each used for different domains)

1. **Supabase** (`lib/supabase.ts`) — primary DB. Server-side service-role key via `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars. Used for:
   - `ft_*` tables: order items, fulfillments (inbound/outbound), cancellations, box info, shipments
   - `invoiceManager_*` tables: labels, 1688 orders, employees, fulfillments
   - `users_api`: Coupang user list
2. **Google Sheets** (JWT service account via `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`) — spreadsheet-per-user, fixed sheet names (`'진행'`, `'작업'`, `'LABEL'`, `'LABEL_kids'`). Used for warehouse-floor data entry that users edit directly in Sheets. Many pages load from Sheets into memory, diff changes, then write back via `/api/save-cells-batch`.
3. **PostgreSQL direct** (`lib/postgres.ts`) and **MongoDB** (`lib/mongodb.ts`) — rare, legacy paths.

### Page organization convention

Each feature lives under `app/<feature-name>/` as `page.tsx` (thin) → `<FeatureName>.tsx` (main component) + `<FeatureName>.css`. Complex features also have `components/`, `hooks/`, `utils/` subfolders (see `app/import-product-v2/`).

**V1 vs V2 coexistence**: Several features have both legacy and rewritten versions running simultaneously — `import-product` vs `import-product-v2`, `export-product` vs `export-product-v2`, `shipment` vs `shipment-v2`, `shipment-complete-v2`, `return-product-v2`. V1 generally = Google Sheets-backed, V2 = Supabase `ft_*` tables. Do not assume one is deprecated — both are in active use. Utilities are version-specific (e.g. `saveLabelDataV1.ts` vs `saveLabelData.ts`).

### API routes (`app/api/`)

Most routes follow a flat convention: one folder per endpoint containing `route.ts`. Sub-namespaces:
- `app/api/ft/*` — Supabase `ft_*` tables (V2 flows)
- `app/api/hr/*` — HR features (employees, attendance, payroll, workers, verify-access)
- `app/api/debug/*` — ad-hoc diagnostic endpoints for investigation (non-mutating reads + analysis)
- `app/api/save-*`, `load-*`, `get-*`, `update-*`, `upload-*` — Google Sheets or mixed operations

Save APIs typically do: **delete existing rows for a scope → insert new rows** (see `/api/save-fashion-label`, `/api/save-scan-data`). Be aware this means concurrent writes by two operators will collide.

### Key cross-cutting concerns

- **i18n** (`lib/i18n.ts`): `ko` (default) / `zh`. Translations in `locales/ko.json` + `locales/zh.json`. Access via `useTranslation()` + `t('namespace.key')`. Language toggle lives in `component/TopsideMenu.tsx`, state in `contexts/LanguageContext.tsx`. Both JSON files must stay in sync when adding keys.
- **Global contexts** (`contexts/`): `LanguageContext`, `SidebarContext`, `SaveContext` (unsaved-changes tracking for warnings on navigation).
- **Supabase pagination**: default row limit is 1000. Use the `fetchAll` helper in `lib/confirmDone.ts` (or equivalent loop elsewhere) for full-table scans.
- **Operator identity** is split into two concepts on import/export pages: **Worker** (from `invoiceManager_employees` WHERE `status='WORKING'` AND `role IN ('매니저','검수')`, fetched via `/api/hr/workers`) stored as `operator_name`, and **PC-NO** (manual 1–4 selection) stored as `operator_no`. These replaced the earlier hardcoded `OPERATOR_ID_MAP`.
- **Set products**: items where `set_total > 1` sharing a `product_no` (after 3-part normalization `BZ-260224-0202-A01` → `BZ-260224-0202`) must be deduped to a single label row. This dedup lives in `/api/save-fashion-label/route.ts`; do not remove it without reading `docs/` context in git history (commit `729f607`).

## Development conventions

- **Don't create new files unless necessary.** Edit existing ones. Especially don't add markdown docs/READMEs unprompted.
- **Don't add `console.log`** except as genuine `console.error` in catch blocks. The codebase was cleaned of debug logs (commit `729f607`) after a render-time log in `ItemTableRow.tsx` caused infinite console spam.
- **Alerts vs modals**: user-facing save results on the newer flows (`/import-product` postgre save) use `component/SaveResultModal.tsx` with i18n + auto-dismiss on success. Older flows still use `alert()` — do not mass-migrate; change only what the user asks for.
- **Every `.tsx` page has a co-located `.css`** — style in CSS file, not inline. Follow the sectioned-comment pattern (`/* ============================================================ */`) seen across the codebase.
- **Running site**: this project is deployed (Railway) and used by warehouse workers daily. Treat all changes as affecting production. Avoid speculative refactors; match the scope of the user's request exactly.

## Env vars (required)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (with `\n` escapes). Absent values cause startup-time errors in `lib/supabase.ts`.

## From `.cursor/rules/cursor-main-rule.mdc`

- Don't add features beyond what was requested.
- Destructive operations (deleting files/scripts) require explicit user approval.
- Each page = `.tsx` + `.css` pair; factor code accordingly rather than hardcoding.
