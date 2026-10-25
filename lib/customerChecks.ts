// ============================================================
// 고객 검수 확인 (ft_customer_checks) — 공용 상수·타입·전이 규칙
//
//   · 입고 V2/V3 [고객확인] 모달 → POST /api/ft/customer-checks 로 저장
//   · 창고 화면 /customer-checks 가 목록·상세·상태 전이를 다룬다
//   · 고객 답변은 purchase-agent 가 DB 함수 customer_check_answer 로 기록한다
//
//   상태·선택 값은 DB 에 한글 원문으로 저장한다 (Notion 과 동일). 화면 번역은 i18n.
//   스키마: supabase/inspection/001_customer_checks.sql
// ============================================================

// ── 상태 ──
export const CHECK_STATUSES = ['확인요청', '재확인요청', '답변완료', '처리완료'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

// ── 고객 선택 ──
export const CHECK_DECISIONS = ['출고', '취소', '재문의', '출고수량변경'] as const;
export type CheckDecision = (typeof CHECK_DECISIONS)[number];

// ── 사이즈 코드 (배송 유형 배지와 동일) ──
export const CHECK_SIZE_CODES = ['A', 'B', 'C', 'P', 'X'] as const;

// ── 목록 탭 → 포함 상태 ──
//   open     : 고객 답을 기다리는 건 (팀 탭)
//   answered : 고객이 답한 건 — 창고가 처리할 차례
//   done     : 처리완료
export const CHECK_TABS = ['open', 'answered', 'done'] as const;
export type CheckTab = (typeof CHECK_TABS)[number];

export const CHECK_TAB_STATUSES: Record<CheckTab, readonly CheckStatus[]> = {
  open: ['확인요청', '재확인요청'],
  answered: ['답변완료'],
  done: ['처리완료'],
};

// ── 창고 전이 (PATCH /api/ft/customer-checks/[id]) ──
//   from 에 없는 상태에서 요청하면 API 가 409 로 거절한다 (조건부 UPDATE 0행).
export const CHECK_ACTIONS = ['recheck', 'close', 'reopen'] as const;
export type CheckAction = (typeof CHECK_ACTIONS)[number];

export const CHECK_TRANSITIONS: Record<
  CheckAction,
  { from: readonly CheckStatus[]; to: CheckStatus; commentRequired: boolean }
> = {
  // 고객 답변을 보고 다시 묻는다 — 무엇을 다시 확인할지 댓글 필수
  recheck: { from: ['답변완료'], to: '재확인요청', commentRequired: true },
  // 종료 — 고객 답 없이도 종료할 수 있다
  close: { from: ['확인요청', '재확인요청', '답변완료'], to: '처리완료', commentRequired: false },
  // 종료 건을 다시 연다 — 고객에게 다시 묻는 상태로
  reopen: { from: ['처리완료'], to: '재확인요청', commentRequired: false },
};

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
  decision_qty: number | null;
  requested_by: string | null;
  answered_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 목록 행 — 댓글·이미지 수를 함께 내려준다 */
export interface CustomerCheckListRow extends CustomerCheckRow {
  comment_count: number;
  image_count: number;
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

/** 목록 응답의 건수 — 팀 탭 배지 + 상단 탭 배지 */
export interface CustomerCheckCounts {
  /** user_id → 미처리(확인요청·재확인요청) 건수 */
  openByUser: Record<string, number>;
  answered: number;
  done: number;
}

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
