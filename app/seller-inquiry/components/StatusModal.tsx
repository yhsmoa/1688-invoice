'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SELLER_INQUIRY_TRANSITIONS,
  type SellerInquiryListRow,
  type SellerInquiryStatus,
} from '../../../lib/sellerInquiries';
import { STATUS_CLASS } from '../utils/display';
import { patchSellerInquiry } from '../utils/sellerInquiryApi';
import './StatusModal.css';

// ============================================================
// StatusModal — 목록 [처리상태] 칸을 눌렀을 때 상태 변경
//
//   보기는 SELLER_INQUIRY_TRANSITIONS[현재 상태] 만 (서버도 같은 규칙으로 막는다) + 취소.
//   고르면 PATCH /api/ft/seller-inquiries/[id] { status } → onChanged (목록 새로고침).
//   실패(다른 작업자가 먼저 바꿈 409 등)는 모달 안에 작은 문구로 보여 준다.
//   모양: 작은 흰 상자 — 제목·배송번호 / 현재 상태 칩 / 평평한 한 줄 보기들 / 글자형 [취소]
// ============================================================

interface StatusModalProps {
  /** null 이면 닫힘 */
  inquiry: SellerInquiryListRow | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

const StatusModal: React.FC<StatusModalProps> = ({ inquiry, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<SellerInquiryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 열릴 때 초기화 ──
  useEffect(() => { setBusy(null); setError(null); }, [inquiry?.id]);

  // ── Escape 로 닫기 (저장 중 제외) ──
  useEffect(() => {
    if (!inquiry) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inquiry, busy, onClose]);

  if (!inquiry) return null;

  const nextList = SELLER_INQUIRY_TRANSITIONS[inquiry.status];

  const choose = async (next: SellerInquiryStatus) => {
    if (busy) return;
    setBusy(next);
    setError(null);
    try {
      await patchSellerInquiry(inquiry.id, { status: next }, t('sellerInquiry.saveError'));
      await onChanged();
      onClose();
    } catch (e) {
      console.error('seller-inquiry 상태 변경 오류:', e);
      setError(e instanceof Error ? e.message : t('sellerInquiry.saveError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="si-sm-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="si-sm-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <div className="si-sm-header">
          <h2>{t('sellerInquiry.statusModal.title')}</h2>
          <div className="si-sm-code">{inquiry.delivery_code}</div>
        </div>

        {/* ── 현재 상태 ── */}
        <div className="si-sm-current">
          <span>{t('sellerInquiry.statusModal.current')}</span>
          <span className={`si-status ${STATUS_CLASS[inquiry.status]}`}>{t(`sellerInquiry.status.${inquiry.status}`)}</span>
        </div>

        {/* ── 바꿀 상태 ── */}
        <div className="si-sm-options">
          {nextList.length === 0 && <p className="si-sm-none">{t('sellerInquiry.statusModal.none')}</p>}
          {nextList.map((next) => (
            <button
              key={next}
              type="button"
              className={`si-sm-option ${STATUS_CLASS[next]}`}
              disabled={busy !== null}
              onClick={() => choose(next)}
            >
              {/* 점 색 = 바뀔 상태 색 · 오른쪽 › = 누르는 버튼 표시 */}
              <span className="si-sm-option-dot" aria-hidden="true" />
              <span className="si-sm-option-label">
                {busy === next ? t('sellerInquiry.statusModal.saving') : t(`sellerInquiry.to.${next}`)}
              </span>
              <span className="si-sm-option-arrow" aria-hidden="true">›</span>
            </button>
          ))}
        </div>

        {error && <div className="si-sm-error">{error}</div>}

        {/* ── 푸터 ── */}
        <div className="si-sm-footer">
          <button type="button" className="si-sm-cancel" onClick={onClose} disabled={busy !== null}>
            {t('sellerInquiry.statusModal.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusModal;
