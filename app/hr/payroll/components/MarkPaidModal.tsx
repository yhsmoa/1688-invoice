'use client';

import React from 'react';
import './MarkPaidModal.css';

// ============================================================
// 급여지급완료 확인 모달
//
//   [부분엑셀] 모드에서 고른 시간을 직원별로 묶어 보여주고, 지급일을 받아 확정한다.
//   금액 = floor(시급 × 선택 시간 합 / 60) — [부분엑셀] 엑셀의 Estimated Salary 와 같은 값.
//   지급일: 오늘(KST) 이하, 선택한 가장 늦은 근무일 이상 (DB 도 같은 규칙으로 검증)
// ============================================================

export interface MarkPaidRow {
  employeeId: string;
  name: string;
  nameKr: string | null;
  days: number;
  minutes: number;
  hourlyWage: number | null;
  amount: number;
}

interface MarkPaidModalProps {
  rows: MarkPaidRow[];
  paidDate: string;
  /** 지급일 하한 — 선택한 가장 늦은 근무일 */
  minDate: string;
  /** 지급일 상한 — 오늘(KST) */
  maxDate: string;
  isSaving: boolean;
  error: string;
  onChangeDate: (date: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** 분 → "8.5h" */
const toHours = (minutes: number): string => {
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
};

const MarkPaidModal: React.FC<MarkPaidModalProps> = ({
  rows, paidDate, minDate, maxDate, isSaving, error, onChangeDate, onConfirm, onClose,
}) => {
  const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalDays = rows.reduce((s, r) => s + r.days, 0);
  const noWage = rows.filter((r) => !r.hourlyWage);

  // 지급일 범위가 성립하지 않으면(미래 근무일 포함) 확정할 수 없다
  const rangeInvalid = minDate > maxDate;
  const dateInvalid = !paidDate || paidDate < minDate || paidDate > maxDate;

  return (
    <div className="pmp-overlay" onClick={() => !isSaving && onClose()}>
      <div className="pmp-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── 헤더 ── */}
        <div className="pmp-header">
          <div>
            <h3 className="pmp-title">급여 지급완료</h3>
            <p className="pmp-sub">선택한 {totalDays}건 · 지급완료로 표시하면 그 시간은 수정·삭제가 잠깁니다</p>
          </div>
          <button className="pmp-close" onClick={onClose} disabled={isSaving}>×</button>
        </div>

        {/* ── 직원별 합계 ── */}
        <div className="pmp-body">
          <table className="pmp-table">
            <thead>
              <tr>
                <th>이름</th>
                <th className="pmp-num">일수</th>
                <th className="pmp-num">시간</th>
                <th className="pmp-num">시급</th>
                <th className="pmp-num">금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td>
                    {r.name}
                    {r.nameKr && <span className="pmp-name-kr">{r.nameKr}</span>}
                  </td>
                  <td className="pmp-num">{r.days}</td>
                  <td className="pmp-num">{toHours(r.minutes)}</td>
                  <td className="pmp-num">{r.hourlyWage ? r.hourlyWage.toLocaleString() : '-'}</td>
                  <td className="pmp-num pmp-amount">{r.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>합계</td>
                <td className="pmp-num">{totalDays}</td>
                <td className="pmp-num">{toHours(totalMinutes)}</td>
                <td />
                <td className="pmp-num pmp-amount">{totalAmount.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>

          {noWage.length > 0 && (
            <p className="pmp-warn">
              시급이 없는 직원이 있어 금액이 0 으로 계산됩니다: {noWage.map((r) => r.name).join(', ')}
            </p>
          )}

          {/* ── 지급일 ── */}
          <div className="pmp-date-row">
            <label className="pmp-date-label" htmlFor="pmp-paid-date">지급일</label>
            <input
              id="pmp-paid-date"
              type="date"
              className="pmp-date-input"
              value={paidDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => onChangeDate(e.target.value)}
              disabled={isSaving || rangeInvalid}
            />
            <span className="pmp-date-hint">{minDate} ~ {maxDate}</span>
          </div>

          {rangeInvalid && (
            <p className="pmp-error">오늘 이후 날짜의 시간이 선택되어 있어 지급완료할 수 없습니다.</p>
          )}
          {error && <p className="pmp-error">{error}</p>}
        </div>

        {/* ── 푸터 ── */}
        <div className="pmp-footer">
          <button className="pmp-btn-cancel" onClick={onClose} disabled={isSaving}>취소</button>
          <button
            className="pmp-btn-confirm"
            onClick={onConfirm}
            disabled={isSaving || rangeInvalid || dateInvalid || rows.length === 0}
          >
            {isSaving ? '처리 중...' : '지급완료 처리'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MarkPaidModal;
