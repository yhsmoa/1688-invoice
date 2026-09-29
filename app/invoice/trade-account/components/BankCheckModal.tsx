'use client';

import React, { useEffect, useState } from 'react';
import { fmtSigned, fmtYuan, type BankCheck, type PendingRefunds, type TradeStatus } from '../../../../lib/tradeLedger';
import { tradeFetch } from '../hooks/useTradeApi';

// ============================================================
// BankCheckModal — 주간 통장 대조
//   실제 통장잔고를 입력 → 장부 통장잔고와 차이 표시 → (선택) '보정' 행으로 장부를 실제에 맞춤.
//   차이의 흔한 원인(이월 전 입금된 판매자 환불분 등)을 환불예정 숫자와 함께 보여준다.
// ============================================================

interface Props {
  status: TradeStatus;
  onClose: () => void;
  onSaved: () => void;
}

const fmtKst = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

const pendingSeller = (p: PendingRefunds | null) => (p ? p.done_seller + p.processing_seller : 0);

const BankCheckModal: React.FC<Props> = ({ status, onClose, onSaved }) => {
  const [actual, setActual] = useState('');
  const [adjust, setAdjust] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<BankCheck[]>([]);

  useEffect(() => {
    tradeFetch<{ checks: BankCheck[] }>('bank-check')
      .then((j) => setHistory(j.checks))
      .catch((e) => console.error('통장 대조 이력 조회 오류:', e));
  }, []);

  const ledger = status.bankBalance ?? 0;
  const actualNum = Number(actual);
  const valid = actual !== '' && Number.isFinite(actualNum);
  const diff = valid ? Math.round((actualNum - ledger) * 100) / 100 : null;
  const willAdjust = adjust && diff != null && Math.abs(diff) >= 0.005;

  const handleSave = async () => {
    if (!valid || saving) return;
    if (willAdjust && !note.trim()) { alert('보정을 기록하려면 차이의 사유를 적어주세요.'); return; }
    const ok = window.confirm(
      `통장 대조를 기록합니다.\n\n실제 통장: ${fmtYuan(actualNum)}\n장부 통장: ${fmtYuan(ledger)}\n차이: ${fmtSigned(diff)}\n` +
      (willAdjust ? `\n차이 ${fmtSigned(diff)} 를 '보정' 행으로 기록해 장부를 실제에 맞춥니다 (손익 반영).` : '\n보정 없이 대조 결과만 남깁니다.') +
      '\n\n진행할까요?',
    );
    if (!ok) return;
    setSaving(true);
    try {
      const json = await tradeFetch<{ result: { diff: number; adjustment_id: string | null } }>('bank-check', {
        method: 'POST',
        body: JSON.stringify({ actual_bank: actualNum, adjust: willAdjust, note: note.trim() || null }),
      });
      alert(`대조 완료 — 차이 ${fmtSigned(json.result.diff)}${json.result.adjustment_id ? ' (보정 기록됨)' : ''}`);
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : '대조 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ta-modal-overlay" onClick={() => !saving && onClose()}>
      <div className="ta-modal ta-modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="ta-modal-title">통장 대조</h3>
        <p className="ta-modal-desc">
          매주 실제 통장잔고를 입력해 장부와 맞춥니다. 차이가 있으면 보정 행으로 장부를 실제에 맞출 수 있습니다 (원본은 남고, 손익에 반영).
          첫 대조에서는 이월 전에 이미 입금된 판매자 환불분이 월요일 정산 때 한 번 더 더해져 차이가 날 수 있습니다.
        </p>

        <div className="ta-check-grid">
          <div className="ta-check-box">
            <span className="ta-card-label">장부 통장잔고</span>
            <span className="ta-check-value">{fmtYuan(ledger)}</span>
            <span className="ta-card-unit">마지막 기록 {status.lastAt ? fmtKst(status.lastAt) : '-'}</span>
          </div>
          <div className="ta-check-box">
            <span className="ta-card-label">실제 통장잔고 (위안)</span>
            <input type="number" step="0.01" className="ta-check-input" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="통장 앱의 현재 잔고" autoFocus disabled={saving} />
          </div>
          <div className={`ta-check-box ${diff == null ? '' : Math.abs(diff) < 0.005 ? 'is-ok' : 'is-diff'}`}>
            <span className="ta-card-label">차이 (실제 − 장부)</span>
            <span className="ta-check-value">{diff == null ? '—' : fmtSigned(diff)}</span>
            <span className="ta-card-unit">
              환불예정 판매자분 {fmtYuan(pendingSeller(status.pendingRefunds), 0)} 중 이미 입금된 금액이 원인일 수 있음
            </span>
          </div>
        </div>

        <label className="ta-checkbox">
          <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} disabled={saving} />
          차이가 있으면 '보정' 행을 만들어 장부를 실제에 맞춘다
        </label>

        <div className="ta-field">
          <label>{willAdjust ? '차이 사유 (필수)' : '메모'}</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={willAdjust ? '예: 이월 전 입금된 판매자 환불분' : ''} disabled={saving} />
        </div>

        {history.length > 0 && (
          <div className="ta-payroll-table-wrap">
            <table className="ta-payroll-table">
              <thead>
                <tr><th>대조 시각</th><th className="ta-num">실제</th><th className="ta-num">장부</th><th className="ta-num">차이</th><th>보정</th><th>메모</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtKst(h.checked_at)}</td>
                    <td className="ta-num">{fmtSigned(h.actual_bank)}</td>
                    <td className="ta-num">{fmtSigned(h.ledger_bank)}</td>
                    <td className={`ta-num ${Math.abs(h.diff) < 0.005 ? '' : 'ta-out'}`}>{fmtSigned(h.diff)}</td>
                    <td>{h.adjustment_id ? '기록' : '-'}</td>
                    <td className="ta-sub">{h.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ta-modal-actions">
          <button className="ta-btn" onClick={onClose} disabled={saving}>닫기</button>
          <button className="ta-btn ta-btn--primary" onClick={handleSave} disabled={!valid || saving}>
            {saving ? '기록 중...' : willAdjust ? '대조 + 보정 기록' : '대조 기록'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BankCheckModal;
