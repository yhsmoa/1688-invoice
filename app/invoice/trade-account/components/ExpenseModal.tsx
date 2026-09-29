'use client';

import React, { useRef, useState } from 'react';
import {
  CATEGORY_DIRECTION,
  COMPANY_CATEGORIES,
  fmtYuan,
  isAdjustCategory,
  todayKST,
  type CompanyCategory,
} from '../../../../lib/tradeLedger';
import { tradeFetch } from '../hooks/useTradeApi';

// ============================================================
// ExpenseModal — 회사 행 입력: 경비 · 인출 · 자본투입 · 환차 · 보정
//   저장 시도마다 참조키(TRADE-{구분}-{ts})를 만들고 재시도에는 같은 키 → 서버가 중복 차단
// ============================================================

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const ExpenseModal: React.FC<Props> = ({ onClose, onSaved }) => {
  const [date, setDate] = useState(todayKST());
  const [category, setCategory] = useState<CompanyCategory>('전기세');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [krw, setKrw] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const refKey = useRef<string | null>(null);

  const adjust = isAdjustCategory(category);
  const fixedDirection = CATEGORY_DIRECTION[category] ?? null;
  const effDirection = fixedDirection ?? direction;
  const amountNum = Number(amount);
  const valid =
    !!date && Number.isFinite(amountNum) && amountNum > 0 && description.trim() !== '' && (!adjust || note.trim() !== '');

  const handleSave = async () => {
    if (!valid || saving) return;
    const ok = window.confirm(
      `무역계좌에 기록합니다.\n\n구분: ${category} (${effDirection === 'in' ? '입금' : '출금'})\n금액: ${fmtYuan(amountNum)}\n내용: ${description.trim()}\n적용일: ${date}\n\n진행할까요?`,
    );
    if (!ok) return;
    if (!refKey.current) refKey.current = `TRADE-${category}-${Date.now()}`;
    setSaving(true);
    try {
      await tradeFetch('transactions', {
        method: 'POST',
        body: JSON.stringify({
          rows: [{
            applied_date: date,
            category,
            type: effDirection,
            amount: amountNum,
            krw_amount: krw ? Number(krw) : null,
            description: description.trim(),
            reference_id: refKey.current,
            admin_note: note.trim() || null,
          }],
        }),
      });
      refKey.current = null;
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : '기록 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ta-modal-overlay" onClick={() => !saving && onClose()}>
      <div className="ta-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ta-modal-title">회사 거래 추가</h3>
        <p className="ta-modal-desc">급여는 [급여 반영]에서, 고객 거래는 고객계좌(신)에서 기록합니다.</p>

        <div className="ta-field-row">
          <div className="ta-field">
            <label>적용일</label>
            <input type="date" value={date} max={todayKST()} onChange={(e) => setDate(e.target.value)} disabled={saving} />
          </div>
          <div className="ta-field">
            <label>구분</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as CompanyCategory)} disabled={saving}>
              {COMPANY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="ta-field-row">
          <div className="ta-field">
            <label>방향</label>
            {fixedDirection ? (
              <div className="ta-readonly">{fixedDirection === 'in' ? '입금 (통장 +)' : '출금 (통장 −)'}</div>
            ) : (
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')} disabled={saving}>
                <option value="out">출금 (통장 −)</option>
                <option value="in">입금 (통장 +)</option>
              </select>
            )}
          </div>
          <div className="ta-field">
            <label>금액 (위안)</label>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} />
          </div>
        </div>

        <div className="ta-field-row">
          <div className="ta-field">
            <label>내용</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="예: 9월 전기세" disabled={saving} />
          </div>
          <div className="ta-field">
            <label>원화 실제 금액 (선택)</label>
            <input type="number" min="0" step="1" value={krw} onChange={(e) => setKrw(e.target.value)} placeholder="환전·송금 건" disabled={saving} />
          </div>
        </div>

        <div className="ta-field">
          <label>{adjust ? '사유 (필수)' : '비고'}</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={adjust ? '통장 대조 결과 등 사유를 적어주세요' : ''} disabled={saving} />
        </div>

        <div className="ta-modal-actions">
          <button className="ta-btn" onClick={onClose} disabled={saving}>취소</button>
          <button className="ta-btn ta-btn--primary" onClick={handleSave} disabled={!valid || saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpenseModal;
