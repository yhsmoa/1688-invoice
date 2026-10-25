'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CheckDecision, CheckStatus } from '../../../lib/customerChecks';

// ============================================================
// 고객 검수 확인 — 배지 (상태 · 고객 선택 · 팀 · 사이즈)
//
//   상태 색 (화면 전체에서 같은 색 = 같은 단계):
//     확인요청(답변 필요) 호박 · 재문의 보라 · 답변완료 초록 · 처리완료 회색
//   고객 선택: 출고 초록 · 취소 장미 · 재문의 보라
//   CSS 클래스는 값에 따라 고정 매핑 (한글 값을 클래스명에 쓰지 않는다)
// ============================================================

export const STATUS_TONE: Record<CheckStatus, string> = {
  '확인요청': 'tone-amber',
  '재문의': 'tone-violet',
  '답변완료': 'tone-emerald',
  '처리완료': 'tone-zinc',
};

const DECISION_TONE: Record<CheckDecision, string> = {
  '출고': 'tone-emerald',
  '취소': 'tone-rose',
  '재문의': 'tone-violet',
};

export const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <span className={`cc-pill ${STATUS_TONE[status] ?? 'tone-zinc'}`}>
      <span className="cc-pill-dot" aria-hidden="true" />
      {t(`customerChecks.status.${status}`, status)}
    </span>
  );
};

export const DecisionBadge: React.FC<{ decision: CheckDecision | null }> = ({ decision }) => {
  const { t } = useTranslation();
  if (!decision) return null;
  return (
    <span className={`cc-pill cc-pill-solid ${DECISION_TONE[decision] ?? 'tone-zinc'}`}>
      {t(`customerChecks.decision.${decision}`, decision)}
    </span>
  );
};

export const TeamBadge: React.FC<{ code: string }> = ({ code }) => (
  <span className="cc-team">{code}</span>
);

/** 배송 사이즈 코드 — 입고 화면 size-badge 와 같은 색 */
const SIZE_CLASS: Record<string, string> = { A: 'is-blue', B: 'is-blue', C: 'is-blue', P: 'is-orange', X: 'is-black' };

export const SizeBadge: React.FC<{ code: string | null }> = ({ code }) => {
  if (!code) return null;
  return <span className={`cc-size ${SIZE_CLASS[code] ?? 'is-gray'}`}>{code}</span>;
};
