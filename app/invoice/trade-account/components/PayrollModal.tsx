'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { fmtYuan, todayKST, type PayrollPreviewRow } from '../../../../lib/tradeLedger';
import { tradeFetch } from '../hooks/useTradeApi';

// ============================================================
// PayrollModal — 급여 반영
//   급여장부와 같은 계산으로 예상액을 보여주고, 실지급액을 확인·수정한 뒤 한 번에 기록.
//   이미 기록된 직원은 잠금. 같은 달·같은 직원은 서버가 참조키로 중복 차단.
// ============================================================

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const minutesToHours = (m: number) => (m > 0 ? `${Math.round(m / 6) / 10}h` : '-');

const PayrollModal: React.FC<Props> = ({ onClose, onSaved }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [paidDate, setPaidDate] = useState(todayKST());
  const [rows, setRows] = useState<PayrollPreviewRow[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await tradeFetch<{ rows: PayrollPreviewRow[] }>(`payroll/preview?year=${year}&month=${month}`);
        if (signal.cancelled) return;
        setRows(json.rows);
        const init: Record<string, string> = {};
        for (const r of json.rows) init[r.employeeId] = String(r.recorded ? r.recorded.amount : r.expectedAmount);
        setAmounts(init);
      } catch (e) {
        if (!signal.cancelled) { setError(e instanceof Error ? e.message : '조회 실패'); setRows([]); }
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [year, month]);

  const pending = useMemo(() => rows.filter((r) => !r.recorded), [rows]);
  const total = pending.reduce((acc, r) => acc + (Number(amounts[r.employeeId]) || 0), 0);
  const allValid = pending.length > 0 && pending.every((r) => Number(amounts[r.employeeId]) > 0) && !!paidDate;

  const yearOptions = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1];

  const handleSave = async () => {
    if (!allValid || saving) return;
    const ok = window.confirm(
      `${year}년 ${month}월 급여 ${pending.length}명, 합계 ${fmtYuan(total)} 을(를) 지급일 ${paidDate} 로 기록합니다.\n\n진행할까요?`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await tradeFetch('payroll/commit', {
        method: 'POST',
        body: JSON.stringify({
          month: `${year}-${String(month).padStart(2, '0')}-01`,
          paid_date: paidDate,
          rows: pending.map((r) => ({
            employee_id: r.employeeId,
            name: r.name,
            amount: Number(amounts[r.employeeId]),
            expected_amount: r.expectedAmount,
          })),
        }),
      });
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : '급여 기록 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ta-modal-overlay" onClick={() => !saving && onClose()}>
      <div className="ta-modal ta-modal--wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="ta-modal-title">급여 반영</h3>
        <p className="ta-modal-desc">
          예상 급여 = 출근기록 × 시급 (급여장부와 같은 계산). 실지급액을 확인·수정한 뒤 기록합니다.
          이미 기록된 직원은 잠깁니다.
        </p>

        <div className="ta-field-row">
          <div className="ta-field">
            <label>귀속월</label>
            <div className="ta-inline">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={saving}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={saving}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>
          </div>
          <div className="ta-field">
            <label>지급일 (적용일)</label>
            <input type="date" value={paidDate} max={todayKST()} onChange={(e) => setPaidDate(e.target.value)} disabled={saving} />
          </div>
        </div>

        <div className="ta-payroll-table-wrap">
          {loading ? (
            <div className="ta-state">불러오는 중...</div>
          ) : error ? (
            <div className="ta-state ta-state--error">{error}</div>
          ) : rows.length === 0 ? (
            <div className="ta-state">{year}년 {month}월 근무 기록이 없습니다.</div>
          ) : (
            <table className="ta-payroll-table">
              <thead>
                <tr>
                  <th>이름</th><th>직책</th><th>시급</th><th>근무</th><th>예상</th><th>실지급액</th><th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const locked = !!r.recorded;
                  const val = amounts[r.employeeId] ?? '';
                  const diff = locked && r.recorded ? r.recorded.amount - r.expectedAmount : 0;
                  return (
                    <tr key={r.employeeId} className={locked ? 'is-locked' : ''}>
                      <td>{r.name}{r.nameKr ? <span className="ta-sub"> {r.nameKr}</span> : null}</td>
                      <td>{r.role || '-'}</td>
                      <td className="ta-num">{r.hourlyWage ?? '-'}</td>
                      <td className="ta-num">{minutesToHours(r.totalMinutes)}</td>
                      <td className="ta-num">{r.expectedAmount.toLocaleString()}</td>
                      <td className="ta-num">
                        {locked ? (
                          r.recorded!.amount.toLocaleString()
                        ) : (
                          <input
                            type="number" min="0" step="0.01" className="ta-payroll-input"
                            value={val}
                            onChange={(e) => setAmounts((prev) => ({ ...prev, [r.employeeId]: e.target.value }))}
                            disabled={saving}
                          />
                        )}
                      </td>
                      <td>
                        {locked
                          ? <span className="ta-badge ta-badge--muted" title={`기록됨 (${r.recorded!.appliedDate})${Math.abs(diff) >= 0.005 ? ` · 예상과 ${diff > 0 ? '+' : ''}${diff.toLocaleString()} 차이` : ''}`}>기록됨</span>
                          : <span className="ta-badge">대기</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="ta-modal-actions">
          <span className="ta-modal-summary">대기 {pending.length}명 · 합계 {fmtYuan(total)}</span>
          <button className="ta-btn" onClick={onClose} disabled={saving}>닫기</button>
          <button className="ta-btn ta-btn--primary" onClick={handleSave} disabled={!allValid || saving}>
            {saving ? '기록 중...' : `${pending.length}명 기록`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PayrollModal;
