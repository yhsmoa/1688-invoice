'use client';

import React, { useMemo, useState } from 'react';
import { fmtSigned, fmtYuan, marginPct, type TradePnlRow } from '../../../../lib/tradeLedger';
import { monthRange, useTradePnl } from '../hooks/useTradeApi';

// ============================================================
// PnlTab — 손익 (월별 / 일별)
//   순이익 = 서비스비 수익 + 환불된 서비스비(−) + 급여(−) + 공과금(−) + 기타경비(−) + 환차·보정
//   이익률 = 순이익 ÷ 거래액(고객 차감 총액). 매출(수익 합) 기준은 툴팁.
// ============================================================

type Unit = 'day' | 'month';

const UNIT_LABEL: Record<Unit, string> = { month: '월별', day: '일별' };

const periodLabel = (p: string, unit: Unit) => {
  const [y, m, d] = p.split('-');
  return unit === 'month' ? `${y}년 ${Number(m)}월` : `${Number(m)}/${Number(d)}`;
};

const Cell: React.FC<{ v: number; sign?: boolean }> = ({ v, sign = true }) => (
  <td className={`ta-num ${sign && v > 0 ? 'ta-in' : sign && v < 0 ? 'ta-out' : ''}`}>{Math.abs(v) < 0.005 ? '' : fmtSigned(v)}</td>
);

const PnlTab: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const now = new Date();
  const [unit, setUnit] = useState<Unit>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // 월별: 최근 12개월 / 일별: 선택한 달
  const { from, to } = useMemo(() => {
    if (unit === 'day') return monthRange(year, month);
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`, to: monthRange(now.getFullYear(), now.getMonth() + 1).to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit, year, month]);

  const { periods, loading, error } = useTradePnl(unit, from, to, refreshKey);

  const totals = useMemo(() => {
    const sum = (k: keyof TradePnlRow) => periods.reduce((a, p) => a + Number(p[k] ?? 0), 0);
    const income = sum('service_income') + sum('refund_service');
    const expense = sum('payroll') + sum('utilities') + sum('other_expense');
    return { gmv: sum('gmv'), income, expense, adjust: sum('adjustments'), net: sum('net') };
  }, [periods]);

  const yearOptions = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1];

  return (
    <>
      <div className="ta-toolbar">
        <div className="ta-filters">
          {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
            <button key={u} className={`ta-chip ${unit === u ? 'active' : ''}`} onClick={() => setUnit(u)}>{UNIT_LABEL[u]}</button>
          ))}
        </div>
        {unit === 'day' && (
          <div className="ta-inline">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="ta-select">
              {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="ta-select">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
        )}
      </div>

      {!loading && !error && periods.length > 0 && (
        <div className="ta-summary">
          <div className="ta-card"><span className="ta-card-label">거래액</span><span className="ta-card-value">{fmtYuan(totals.gmv, 0)}</span><span className="ta-card-unit">고객 차감 총액</span></div>
          <div className="ta-card"><span className="ta-card-label">수익</span><span className="ta-card-value">{fmtYuan(totals.income, 0)}</span><span className="ta-card-unit">서비스비 − 환불된 서비스비</span></div>
          <div className="ta-card"><span className="ta-card-label">비용</span><span className="ta-card-value">{fmtYuan(-totals.expense, 0)}</span><span className="ta-card-unit">급여 + 공과금 + 경비</span></div>
          <div className="ta-card ta-card--accent"><span className="ta-card-label">순이익</span><span className="ta-card-value">{fmtYuan(totals.net, 0)}</span><span className="ta-card-unit">이익률 {marginPct(totals.net, totals.gmv) ?? '—'}% (거래액 기준)</span></div>
        </div>
      )}

      <div className="ta-content">
        {loading ? (
          <div className="ta-state">불러오는 중...</div>
        ) : error ? (
          <div className="ta-state ta-state--error">{error}</div>
        ) : periods.length === 0 ? (
          <div className="ta-state">데이터가 없습니다.</div>
        ) : (
          <div className="ta-table-wrap">
            <table className="ta-table ta-pnl-table">
              <thead>
                <tr>
                  <th>기간</th>
                  <th className="ta-num">거래액</th>
                  <th className="ta-num">충전</th>
                  <th className="ta-num">서비스비 수익</th>
                  <th className="ta-num">환불 서비스비</th>
                  <th className="ta-num">급여</th>
                  <th className="ta-num">공과금</th>
                  <th className="ta-num">기타경비</th>
                  <th className="ta-num">환차·보정</th>
                  <th className="ta-num ta-th-strong">순이익</th>
                  <th className="ta-num">이익률</th>
                  <th className="ta-num">통장 기말</th>
                  <th className="ta-num">충전금 기말</th>
                  <th className="ta-num ta-th-strong">자산 기말</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const pct = marginPct(p.net, p.gmv);
                  const pctSales = marginPct(p.net, p.service_income + p.refund_service);
                  return (
                    <tr key={p.period_start}>
                      <td className="ta-strong">{periodLabel(p.period_start, unit)}</td>
                      <td className="ta-num">{fmtSigned(p.gmv)}</td>
                      <td className="ta-num">{p.charges ? fmtSigned(p.charges) : ''}</td>
                      <Cell v={p.service_income} />
                      <Cell v={p.refund_service} />
                      <Cell v={p.payroll} />
                      <Cell v={p.utilities} />
                      <Cell v={p.other_expense} />
                      <Cell v={p.adjustments} />
                      <td className={`ta-num ta-strong ${p.net >= 0 ? 'ta-in' : 'ta-out'}`}>{fmtSigned(p.net)}</td>
                      <td className="ta-num" title={pctSales != null ? `매출 기준 ${pctSales}%` : ''}>{pct != null ? `${pct}%` : '—'}</td>
                      <td className="ta-num">{fmtSigned(p.bank_end)}</td>
                      <td className="ta-num">{fmtSigned(p.customer_end)}</td>
                      <td className="ta-num ta-strong ta-asset">{fmtSigned(p.asset_end)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="ta-footer-note">
        <b>순이익</b> = 서비스비 수익 − 환불된 서비스비 − 급여 − 공과금(전기세·수도가스·임대료·통신비) − 기타경비 ± 환차·보정.
        인출·자본투입은 통장·자산에는 반영되지만 손익에서 제외합니다. <b>이익률</b>은 거래액(고객 차감 총액) 기준이며, 매출(수익 합) 기준은 셀에 마우스를 올리면 보입니다.
        기간은 적용일 기준, 기말 잔고는 그 기간 마지막 기록의 스냅샷입니다. 환불은 판매자 환불분을 그대로 넘기고 받았던 6% 를 돌려주므로 손익에는 서비스비 취소만 남습니다.
      </p>
    </>
  );
};

export default PnlTab;
