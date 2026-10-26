// ============================================================
// 고객 검수 확인 (ft_customer_checks) — 공용 상수·타입·전이 규칙
//
//   · 입고 V2/V3 [고객확인] 모달 → POST /api/ft/customer-checks 로 저장
//   · 창고 화면 /customer-checks 가 목록·상세·상태 전이를 다룬다
//   · 고객 답변은 purchase-agent 가 DB 함수 customer_check_answer 로 기록한다
//
//   상태·선택 값은 DB 에 한글 원문으로 저장한다 (Notion 과 동일). 화면 번역은 i18n.
//   스키마: supabase/inspection/001_customer_checks.sql + 002_customer_checks_reinquiry_flow.sql
// ============================================================

// ── 상태 ──
//   확인요청 = 고객 답변 필요 · 재문의 = 고객이 다시 물음(창고 답변) · 답변완료 = 출고/취소 확정(창고 처리 대기) · 처리완료
export const CHECK_STATUSES = ['확인요청', '재문의', '답변완료', '처리완료'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

// ── 고객 선택 ──
export const CHECK_DECISIONS = ['출고', '취소', '재문의'] as const;
export type CheckDecision = (typeof CHECK_DECISIONS)[number];

// ── 사이즈 코드 (배송 유형 배지와 동일) ──
export const CHECK_SIZE_CODES = ['A', 'B', 'C', 'P', 'X'] as const;

// ── 목록 탭 = 상태 1:1 ──
export const CHECK_TABS = ['open', 'reinquiry', 'answered', 'done'] as const;
export type CheckTab = (typeof CHECK_TABS)[number];

export const CHECK_TAB_STATUS: Record<CheckTab, CheckStatus> = {
  open: '확인요청',
  reinquiry: '재문의',
  answered: '답변완료',
  done: '처리완료',
};

// ── 창고 전이 (PATCH /api/ft/customer-checks/[id]) ──
//   close  : 확인요청(회수)·재문의·답변완료 → 처리완료
//   reopen : 처리완료 → 고객 선택에 따른 원래 단계 (reopenTarget)
//   from 에 없는 상태에서 요청하면 API 가 409 로 거절한다 (조건부 UPDATE 0행).
export const CHECK_ACTIONS = ['close', 'reopen'] as const;
export type CheckAction = (typeof CHECK_ACTIONS)[number];

export const CHECK_ACTION_FROM: Record<CheckAction, readonly CheckStatus[]> = {
  close: ['확인요청', '재문의', '답변완료'],
  reopen: ['처리완료'],
};

/** 다시 열 때 돌아갈 단계 — DB 정합 제약(status ↔ decision)과 같은 규칙 */
export function reopenTarget(decision: CheckDecision | null): CheckStatus {
  if (decision === '재문의') return '재문의';
  if (decision === '출고' || decision === '취소') return '답변완료';
  return '확인요청';
}

// ── 목록 페이지 크기 (서버 페이지네이션 — Supabase 1000행 제한 대응) ──
export const CHECK_PAGE_SIZE = 50;

// ── 댓글 작성자 구분 ──
export type CheckAuthorRole = 'warehouse' | 'customer';

// ============================================================
// 행 타입 (API 응답 = DB 컬럼 그대로)
// ============================================================
export interface CustomerCheckRow {
  id: string;
  user_id: string;
  team_code: string;
  order_item_id: string | null;
  order_no: string | null;
  item_no: string | null;
  product_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  site_url: string | null;
  size_code: string | null;
  order_qty: number | null;
  confirm_qty: number | null;
  arrival_qty: number | null;
  attributes: string[];
  status: CheckStatus;
  decision: CheckDecision | null;
  requested_by: string | null;
  answered_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 목록 행 — 댓글·이미지 수 + 마지막 댓글(작성자·내용 — 재문의에서 창고 답변이 필요한지) */
export interface CustomerCheckListRow extends CustomerCheckRow {
  comment_count: number;
  image_count: number;
  last_comment_role: CheckAuthorRole | null;
  /** 마지막 댓글 내용 — 재문의에서 고객이 마지막에 남긴 말을 카드에 보여 준다 */
  last_comment_body: string | null;
}

export interface CustomerCheckComment {
  id: string;
  check_id: string;
  author_role: CheckAuthorRole;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface CustomerCheckImage {
  id: string;
  check_id: string;
  storage_path: string;
  public_url: string;
  sort_order: number;
  created_at: string;
}

/** 상세 응답 */
export interface CustomerCheckDetail {
  check: CustomerCheckRow;
  comments: CustomerCheckComment[];
  images: CustomerCheckImage[];
  /** 같은 아이템번호의 다른 요청 (최신순, 최대 10) — 중복 요청 여부 확인용 */
  related: Pick<CustomerCheckRow, 'id' | 'status' | 'decision' | 'created_at' | 'team_code'>[];
}

/** 탭 하나의 건수 — 전체 + 팀(user_id)별 */
export interface CheckTabCount {
  total: number;
  byUser: Record<string, number>;
}

/** 목록 응답의 건수 — 상태 타일 + 팀 칩 배지 (검색과 무관한 전체 값) */
export type CustomerCheckCounts = Record<CheckTab, CheckTabCount>;

/** 답변완료 탭에서 모아 볼 고객 선택 (출고분 / 취소분) */
export const ANSWERED_DECISIONS = ['출고', '취소'] as const;
export type AnsweredDecision = (typeof ANSWERED_DECISIONS)[number];

/** 답변완료 탭 출고 / 취소 건수 — 팀 필터 반영 */
export type AnsweredDecisionCounts = Record<AnsweredDecision, number>;

// ============================================================
// 헬퍼
// ============================================================

/** DB 함수 오류 'check: …' 접두사 제거 (화면 표시용) */
export function stripCheckError(message: string): string {
  return message.replace(/^check:\s*/, '');
}

export function isCheckStatus(v: unknown): v is CheckStatus {
  return typeof v === 'string' && (CHECK_STATUSES as readonly string[]).includes(v);
}

export function isCheckTab(v: unknown): v is CheckTab {
  return typeof v === 'string' && (CHECK_TABS as readonly string[]).includes(v);
}

export function isCheckAction(v: unknown): v is CheckAction {
  return typeof v === 'string' && (CHECK_ACTIONS as readonly string[]).includes(v);
}
