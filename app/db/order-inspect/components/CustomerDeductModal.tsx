'use client';

import React, { useEffect, useState } from 'react';
import DeductForm from '../../../invoice/payment-history-v2/components/DeductForm';
import {
  deductAmounts,
  deductConfirmText,
  deductRequestBody,
  fmtYuan,
  userLabel,
  validateDeductForm,
  writeResultText,
  type DeductFormState,
  type FtUserOption,
  type LedgerResponse,
  type WriteResponse,
} from '../../../invoice/payment-history-v2/utils/customerLedger';

// ============================================================
// CustomerDeductModal — [비용처리] → 고객 부담 (고객 충전금에서 차감)
//
//   고객계좌(신) [추가] 모달의 '차감' 탭과 같은 폼(DeductForm)·같은 API 로 기록한다.
//   차이점: 사업자를 이 모달 안에서 고르고, 고르면 원장을 조회해
//   현재 잔액·이월 행·정합(합산 = 스냅샷)을 확인한 뒤에만 저장을 허용한다
//   (고객계좌(신) 의 canWrite 와 같은 규칙).
//   참조키는 1688 주문번호 기준 고정 → 같은 주문을 두 번 차감하면 서버가 차단.
//   스타일: PaymentHistoryV2.css 의 phv2-* (모달·폼) + OrderInspect.css 의 oi-cost-* (추가 요소)
// ============================================================

interface LedgerState {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  snapshotBalance: number | null;
  hasOpening: boolean;
  broken: boolean;
}

const EMPTY_LEDGER: LedgerState = { loading: false, loaded: false, error: null, snapshotBalance: null, hasOpening: false, broken: false };

interface Props {
  /** 미리 채운 입력값 (금액·적용일·항목·1688 주문번호·비고) */
  initial: DeductFormState;
  /** 고정 참조키 — 같은 키 재기록은 서버가 차단 */
  referenceId: string;
  /** 폼 위에 보여줄 맥락 (주문 요약) */
  context?: React.ReactNode;
  onClose: () => void;
  /** 원장에 기록된 뒤 호출 (재조회 검증 실패(committed)도 기록된 상태이므로 포함) */
  onSaved: () => void;
}

const CustomerDeductModal: React.FC<Props> = ({ initial, referenceId, context, onClose, onSaved }) => {
  // ── 사업자 선택 ──
  const [ftUsers, setFtUsers] = useState<FtUserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [ledger, setLedger] = useState<LedgerState>(EMPTY_LEDGER);

  // ── 입력 ──
  const [form, setForm] = useState<DeductFormState>(initial);
  const [showFeeDetail, setShowFeeDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedUser = ftUsers.find((u) => u.id === selectedUserId) ?? null;
  /** 기록 가능 — 조회 완료 + 이월 행 있음 + 정합 (고객계좌(신) canWrite 와 동일) */
  const canWrite = ledger.loaded && !ledger.error && ledger.hasOpening && !ledger.broken;

  // ── 사용자 목록 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ft/users');
        const json = await res.json();
        if (!cancelled && json.success && json.data) setFtUsers(json.data as FtUserOption[]);
      } catch (err) {
        console.error('사용자 목록 조회 오류:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── 사업자 변경 → 원장 조회 (잔액·이월·정합) ──
  useEffect(() => {
    if (!selectedUserId) {
      setLedger(EMPTY_LEDGER);
      return;
    }
    let cancelled = false;
    setLedger({ ...EMPTY_LEDGER, loading: true });
    (async () => {
      try {
        const res = await fetch(`/api/ft/user-transactions?user_id=${encodeURIComponent(selectedUserId)}`);
        const json = (await res.json()) as LedgerResponse;
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || '조회 실패');
        const { snapshotBalance, sumBalance, hasOpening, rows } = json.ledger;
        setLedger({
          loading: false,
          loaded: true,
          error: null,
          snapshotBalance,
          hasOpening: hasOpening && rows.length > 0,
          broken: snapshotBalance != null && Math.abs(snapshotBalance - sumBalance) >= 0.005,
        });
      } catch (err) {
        if (cancelled) return;
        console.error('고객계좌(신) 조회 오류:', err);
        setLedger({ ...EMPTY_LEDGER, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedUserId]);

  // ── 저장 ──
  const handleClose = () => { if (!isSaving) onClose(); };

  const handleSave = async () => {
    if (isSaving) return;
    if (!selectedUser) return alert('쿠팡 사용자를 선택해주세요.');
    if (!canWrite) return alert('원장 상태에 문제가 있어 기록할 수 없습니다.');
    const checked = validateDeductForm(form);
    if (!checked.ok) return alert(checked.error);

    const ok = confirm(deductConfirmText(userLabel(selectedUser), form, checked.values));
    if (!ok) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/ft/user-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deductRequestBody(selectedUser.id, form, checked.values, referenceId)),
      });
      const result = (await response.json()) as WriteResponse;
      if (result.success && result.result) {
        alert(writeResultText('차감 완료', userLabel(selectedUser), result.result));
        onSaved();
      } else if (result.committed) {
        // 기록은 됐으나 재조회 검증 실패 — "완료"로 위장하지 않되, 다시 저장하면 이중 기록이므로 닫는다
        alert(result.error || '기록은 됐으나 검증에 실패했습니다. 관리자 확인 필요.');
        onSaved();
      } else {
        alert(result.error || '기록 실패');
      }
    } catch (err) {
      console.error('차감 기록 오류:', err);
      alert('차감 기록 중 오류가 발생했습니다. 고객계좌(신)에서 기록 여부를 확인한 뒤 다시 시도하세요.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── 미리보기 — 기록 후 잔액 ──
  const { amount: deductAmt } = deductAmounts(form);
  const previewBalance = ledger.snapshotBalance != null && deductAmt > 0
    ? Math.round((ledger.snapshotBalance - deductAmt) * 100) / 100
    : null;

  // ── 원장 상태 문구 ──
  const ledgerStatus = !selectedUserId ? null
    : ledger.loading ? <span className="oi-cost-ledger-muted">원장 조회 중...</span>
    : ledger.error ? <span className="phv2-pill is-broken">⚠ 원장 조회 실패 — {ledger.error}</span>
    : !ledger.hasOpening ? <span className="phv2-pill is-broken">⚠ 신 원장에 이월 행이 없습니다 (미전환 그룹) — 기록 불가</span>
    : ledger.broken ? <span className="phv2-pill is-broken">⚠ 원장 정합성 오류 (합산 ≠ 스냅샷) — 기록 불가, 관리자 확인 필요</span>
    : <span className="phv2-pill is-matched">✓ 원장 정합 — 기록 가능</span>;

  return (
    <div className="phv2-modal-overlay" onClick={handleClose}>
      <div className="phv2-modal is-deduct" onClick={(e) => e.stopPropagation()}>

        {/* ── 헤더: 사업자 선택 + 현재 잔액 ── */}
        <div className="phv2-modal-header">
          <div className="phv2-modal-heading">
            <div className="phv2-modal-title">고객 차감 기록</div>
            <div className="phv2-modal-subtitle">
              <select
                className="phv2-user-dropdown oi-cost-user"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={isSaving}
                autoFocus
              >
                <option value="">차감할 사업자 선택</option>
                {ftUsers.map((u) => (
                  <option key={u.id} value={u.id}>{userLabel(u)}</option>
                ))}
              </select>
              <span className="phv2-badge-ledger">새 원장</span>
            </div>
          </div>
          <div className="phv2-modal-balance">
            <span className="phv2-modal-balance-label">현재 잔액</span>
            <span className="phv2-modal-balance-value">{ledger.snapshotBalance != null ? fmtYuan(ledger.snapshotBalance) : '-'}</span>
          </div>
          <button className="phv2-modal-close" onClick={handleClose} disabled={isSaving} aria-label="닫기">✕</button>
        </div>

        {/* ── 본문: 주문 요약 + 원장 상태 + 차감 폼 (고객계좌(신) 과 공용) ── */}
        <div className="phv2-modal-content">
          {context}
          {ledgerStatus && <div className="oi-cost-ledger">{ledgerStatus}</div>}
          <DeductForm
            form={form}
            onChange={setForm}
            showFeeDetail={showFeeDetail}
            onToggleFeeDetail={() => setShowFeeDetail((v) => !v)}
          />
        </div>

        {/* ── 푸터: 기록 후 예상 잔액 + 저장 ── */}
        <div className="phv2-modal-footer">
          <div className="phv2-modal-preview">
            {previewBalance != null ? (
              <>
                <span className="phv2-modal-preview-label">기록 후 잔액</span>
                <span className={`phv2-modal-preview-value ${previewBalance < 0 ? 'is-negative' : ''}`}>{fmtYuan(previewBalance)}</span>
                <span className="phv2-modal-preview-delta is-minus">−{fmtYuan(deductAmt)}</span>
              </>
            ) : (
              <span className="phv2-modal-preview-muted">
                {selectedUserId ? '금액을 입력하면 기록 후 잔액이 표시됩니다' : '사업자를 선택하면 잔액이 표시됩니다'}
              </span>
            )}
          </div>
          <button className="phv2-modal-cancel-btn" onClick={handleClose} disabled={isSaving}>취소</button>
          <button
            className="phv2-modal-save-btn"
            onClick={handleSave}
            disabled={isSaving || !canWrite}
            title={!selectedUserId ? '먼저 사업자를 선택하세요' : !canWrite ? '원장 상태에 문제가 있어 기록할 수 없습니다' : ''}
          >
            {isSaving ? '저장 중...' : '차감 기록'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerDeductModal;
