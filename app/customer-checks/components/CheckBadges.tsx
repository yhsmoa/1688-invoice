'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CheckDecision, CheckStatus } from '../../../lib/customerChecks';

// ============================================================
// 고객 검수 확인 — 배지 (상태 · 고객 선택 · 팀 · 사이즈)
//
//   미니멀 톤 (고객 화면 purchase-agent /inspections 와 같은 규칙):
//     바탕은 회색·검정, 단계·선택 색은 "작은 점" 하나에만 쓴다.
//     단계 점  답변 필요 호박 · 재문의 보라 · 답변완료 초록 · 처리완료 회색
//     선택 점  출고 초록 · 취소 장미 · 재문의 보라
//   CSS 클래스는 값에 따라 고정 매핑 (한글 값을 클래스명에 쓰지 않는다)
// ============================================================

/** 단계 점 색 클래스 — 타일·배지·진행 바 공용 */
export const STATUS_DOT: Record<CheckStatus, string> = {
  '확인요청': 'dot-amber',
  '재문의': 'dot-violet',
  '답변완료': 'dot-emerald',
  '처리완료': 'dot-gray',
};

/** 고객 선택 점 색 클래스 */
export const DECISION_DOT: Record<CheckDecision, string> = {
  '출고': 'dot-emerald',
  '취소': 'dot-rose',
  '재문의': 'dot-violet',
};

export const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return (
    <span className="cc-pill">
      <span className={`cc-dot ${STATUS_DOT[status] ?? 'dot-gray'}`} aria-hidden="true" />
      {t(`customerChecks.status.${status}`, status)}
    </span>
  );
};

export const DecisionBadge: React.FC<{ decision: CheckDecision | null }> = ({ decision }) => {
  const { t } = useTranslation();
  if (!decision) return null;
  return (
    <span className="cc-pill is-outline">
      <span className={`cc-dot ${DECISION_DOT[decision] ?? 'dot-gray'}`} aria-hidden="true" />
      {t(`customerChecks.decision.${decision}`, decision)}
    </span>
  );
};

export const TeamBadge: React.FC<{ code: string }> = ({ code }) => (
  <span className="cc-team">{code}</span>
);

/** 배송 사이즈 코드 — 입고 화면 size-badge 와 같은 색 (사이트 공통 규칙) */
const SIZE_CLASS: Record<string, string> = { A: 'is-blue', B: 'is-blue', C: 'is-blue', P: 'is-orange', X: 'is-black' };

export const SizeBadge: React.FC<{ code: string | null }> = ({ code }) => {
  if (!code) return null;
  return <span className={`cc-size ${SIZE_CLASS[code] ?? 'is-gray'}`}>{code}</span>;
};
