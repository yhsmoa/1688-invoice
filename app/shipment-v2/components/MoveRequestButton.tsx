'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MoveRequestInfo } from '../types';

// ============================================================
// MoveRequestButton — 상품정보 옆 고객 이동요청 표시·처리
//
//   미처리 : [● A 이동요청…]  (타입색 테두리 + 점 깜빡임)
//            클릭 → POST /api/ft/move-requests/{id}/complete
//              · 박스가 요청 타입이면 → 부모가 [처리완료] 로 바꿈
//              · 아니면 DB 함수 문구 그대로 alert ("아직 X 박스(BZ-X-01)에 있습니다…")
//   처리완료: [✓ 처리완료] 녹색 (이번 화면에서 처리한 건 — 재조회 후엔 표시 없음)
//
//   처리 담당자는 페이지 상단 드롭다운 값 (없으면 안내 후 중단)
// ============================================================

/** 이번 세션에서 처리완료한 요청 (재조회 전까지 녹색 표시) */
export interface CompletedRequest {
  target_type: string;
}

interface MoveRequestButtonProps {
  request: MoveRequestInfo | null;
  completed: CompletedRequest | undefined;
  /** 처리 담당자 ("이름 한글이름") — 비어 있으면 처리 불가 */
  doneBy: string;
  onCompleted: (requestId: string, targetType: string) => void;
}

const formatRequestedAt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const MoveRequestButton: React.FC<MoveRequestButtonProps> = ({ request, completed, doneBy, onCompleted }) => {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  // ── 처리완료 (이번 화면에서) ──
  if (!request && completed) {
    return (
      <span className="sv2-req sv2-req--done">
        <span aria-hidden="true">✓</span>
        <span className={`sv2-type-chip sv2-type-chip--${completed.target_type.toLowerCase()}`}>{completed.target_type}</span>
        {t('shipmentV2.moveRequest.done')}
      </span>
    );
  }
  if (!request) return null;

  const type = request.target_type;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (submitting) return;
    if (!doneBy) {
      alert(t('shipmentV2.worker.required'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/ft/move-requests/${request.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done_by: doneBy }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || t('shipmentV2.moveRequest.error'));
        return;
      }
      onCompleted(request.id, type);
    } catch (err) {
      console.error('이동요청 처리 오류:', err);
      alert(t('shipmentV2.moveRequest.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      type="button"
      className={`sv2-req sv2-req--pending sv2-req--${type.toLowerCase()}`}
      onClick={handleClick}
      disabled={submitting}
      title={t('shipmentV2.moveRequest.tooltip', {
        by: request.requested_by || '-',
        at: formatRequestedAt(request.requested_at),
        from: request.from_box_code || '-',
        type,
      })}
    >
      <span className="sv2-req-dot" aria-hidden="true" />
      <span className={`sv2-type-chip sv2-type-chip--${type.toLowerCase()}`}>{type}</span>
      {t('shipmentV2.moveRequest.pending')}
    </button>
  );
};

export default MoveRequestButton;
