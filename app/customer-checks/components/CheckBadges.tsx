'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CheckDecision, CheckStatus } from '../../../lib/customerChecks';

// ============================================================
// 고객 검수 확인 — 배지 (상태 · 고객 선택 · 팀 · 사이즈)
//
//   색 규칙은 Notion 상품확인 DB 를 계승:
//     상태  확인요청 노랑 · 재확인요청 주황 · 답변완료 초록 · 처리완료 회색
//     선택  출고 초록 · 취소 빨강 · 재문의 노랑 · 출고수량변경 파랑
//   CSS 클래스는 값에 따라 고정 매핑 (한글 값을 클래스명에 쓰지 않는다)
// ============================================================

const STATUS_CLASS: Record<CheckStatus, string> = {
  '확인요청': 'is-requested',
  '재확인요청': 'is-recheck',
  '답변완료': 'is-answered',
  '처리완료': 'is-done',
};

const DECISION_CLASS: Record<CheckDecision, string> = {
  '출고': 'is-ship',
  '취소': 'is-cancel',
  '재문의': 'is-ask',
  '출고수량변경': 'is-qty',
};

export const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <span className={`cc-badge cc-badge-status ${STATUS_CLASS[status] ?? ''}`}>
      {t(`customerChecks.status.${status}`, status)}
    </span>
  );
};

export const DecisionBadge: React.FC<{ decision: CheckDecision | null; qty?: number | null }> = ({ decision, qty }) => {
  const { t } = useTranslation();
  if (!decision) return <span className="cc-badge-empty">–</span>;
  return (
    <span className={`cc-badge cc-badge-decision ${DECISION_CLASS[decision] ?? ''}`}>
      {t(`customerChecks.decision.${decision}`, decision)}
      {decision === '출고수량변경' && qty != null && <strong className="cc-badge-qty">{qty}</strong>}
    </span>
  );
};

export const TeamBadge: React.FC<{ code: string }> = ({ code }) => (
  <span className="cc-badge cc-badge-team">{code}</span>
);

/** 배송 사이즈 코드 — 입고 화면 size-badge 와 같은 색 */
const SIZE_CLASS: Record<string, string> = { A: 'is-blue', B: 'is-blue', C: 'is-blue', P: 'is-orange', X: 'is-black' };

export const SizeBadge: React.FC<{ code: string | null }> = ({ code }) => {
  if (!code) return <span className="cc-badge-empty">–</span>;
  return <span className={`cc-size ${SIZE_CLASS[code] ?? 'is-gray'}`}>{code}</span>;
};
