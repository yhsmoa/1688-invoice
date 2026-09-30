'use client';

import React, { useMemo, useState } from 'react';
import {
  LEDGER_FILTER_LABEL,
  TRADE_KIND_LABEL,
  fmtSigned,
  ledgerFilterOf,
  type LedgerFilter,
  type TradeRow,
} from '../../../../lib/tradeLedger';
import { monthRange, tradeFetch, useTradeLedger } from '../hooks/useTradeApi';

// ============================================================
// LedgerTab — 계좌내역 (월 단위, 구분 필터)
//   세 잔고 열은 DB 스냅샷 그대로(기록 순서 기준). 화면에서 누적 계산하지 않는다.
//   회사 행은 [취소] → 반대 행 추가. 미러 행은 고객계좌(신)에서 처리.
// ============================================================

interface Props {
  /** 탭 선택 버튼 — 컨트롤 줄 왼쪽 (TradeAccount 가 전달) */
  tabSwitcher: React.ReactNode;
  refreshKey: number;
  onChanged: () => void;
  todayRate: number | null;
}

const fmtBal = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });

const LedgerTab: React.FC<Props> = ({ tabSwitcher, refreshKey, onChanged, todayRate }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [reversing, setReversing] = useState<string | null>(null);

  const { from, to } = useMemo(() => monthRange(year, month), [year, month]);
  const { rows, loading, error } = useTradeLedger(from, to, refreshKey);

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => ledgerFilterOf(r) === filter)),
    [rows, filter],
  );

  const totals = useMemo(() => ({
    bankIn: shown.reduce((a, r) => a + (r.bank_delta > 0 ? r.bank_delta : 0), 0),
    bankOut: shown.reduce((a, r) => a + (r.bank_delta < 0 ? -r.bank_delta : 0), 0),
    pnl: shown.reduce((a, r) => a + r.pnl_delta, 0),
  }), [shown]);

  const yearOptions = [now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1];

  const handleReverse = async (row: TradeRow) => {
    const reason = window.prompt(`"${row.description}" (${fmtBal(row.amount)}) 을(를) 취소합니다.\n반대 방향 행이 추가되며 원본은 남습니다.\n\n취소 사유:`);
    if (reason == null) return;
    if (!reason.trim()) { alert('취소 사유를 입력해주세요.'); return; }
    setReversing(row.id);
    try {
      await tradeFetch('reverse', { method: 'POST', body: JSON.stringify({ id: row.id, reason: reason.trim() }) });
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : '취소 실패');
    } finally {
      setReversing(null);
    }
  };

  return (
    <>
      {/* ── 탭행: 왼쪽 탭 / 오른쪽 조회 월 ── */}
      <div className="ta-tabbar">
        {tabSwitcher}
        <div className="ta-inline">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="ta-select">
            {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="ta-select">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
          </select>
        </div>
      </div>

      {/* ── 구분 필터 ── */}
      <div className="ta-filters ta-metric-row">
        {(Object.keys(LEDGER_FILTER_LABEL) as LedgerFilter[]).map((f) => (
          <button key={f} className={`ta-chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {LEDGER_FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="ta-content">
        {loading ? (
          <div className="ta-state">불러오는 중...</div>
        ) : error ? (
          <div className="ta-state ta-state--error">{error}</div>
        ) : shown.length === 0 ? (
          <div className="ta-state">해당 월의 내역이 없습니다.</div>
        ) : (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>적용일</th>
                  <th>구분</th>
                  <th className="ta-th-desc">내용</th>
                  <th className="ta-num">통장 입금</th>
                  <th className="ta-num">통장 출금</th>
                  <th className="ta-num ta-th-strong">통장잔고</th>
                  <th className="ta-num">충전금 Δ</th>
                  <th className="ta-num ta-th-strong">충전금 잔액</th>
                  <th className="ta-num ta-th-strong">회사자산</th>
                  <th className="ta-num">손익</th>
                  <th className="ta-th-ref">참조 · 비고</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const isReversed = !!r.reversed_by;
                  const cls = [
                    r.kind === 'customer' ? 'is-customer' : '',
                    r.kind === 'reversal' ? 'is-reversal' : '',
                    r.kind === 'opening' ? 'is-opening' : '',
                    isReversed ? 'is-reversed' : '',
                  ].join(' ');
                  const canReverse = r.kind === 'company' && !isReversed;
                  return (
                    <tr key={r.id} className={cls}>
                      <td title={`기록 ${r.created_at.slice(0, 16).replace('T', ' ')}`}>{r.applied_date}</td>
                      <td>
                        <span className={`ta-badge ta-badge--${r.kind}`}>{TRADE_KIND_LABEL[r.kind]}</span>
                        <span className="ta-cat">{r.category}</span>
                      </td>
                      <td className="ta-td-desc" title={r.description}>{r.description}</td>
                      <td className="ta-num ta-in">{r.bank_delta > 0 ? fmtSigned(r.bank_delta) : ''}</td>
                      <td className="ta-num ta-out">{r.bank_delta < 0 ? fmtSigned(-r.bank_delta) : ''}</td>
                      <td className="ta-num ta-strong" title={todayRate != null ? `₩${Math.round(r.bank_balance * todayRate).toLocaleString()}` : ''}>{fmtBal(r.bank_balance)}</td>
                      <td className={`ta-num ${r.customer_delta > 0 ? 'ta-in' : r.customer_delta < 0 ? 'ta-out' : ''}`}>{r.customer_delta !== 0 ? fmtSigned(r.customer_delta) : ''}</td>
                      <td className="ta-num ta-strong">{fmtBal(r.customer_balance)}</td>
                      <td className="ta-num ta-strong ta-asset">{fmtBal(r.asset_balance)}</td>
                      <td className={`ta-num ${r.pnl_delta > 0 ? 'ta-in' : r.pnl_delta < 0 ? 'ta-out' : ''}`}>{r.pnl_delta !== 0 ? fmtSigned(r.pnl_delta) : ''}</td>
                      <td className="ta-td-ref" title={`${r.reference_id}${r.admin_note ? `\n${r.admin_note}` : ''}`}>
                        {r.admin_note ? <span className="ta-note">📌 {r.admin_note}</span> : <span className="ta-ref">{r.reference_id}</span>}
                      </td>
                      <td>
                        {canReverse && (
                          <button className="ta-link-btn" onClick={() => handleReverse(r)} disabled={reversing === r.id}>
                            {reversing === r.id ? '…' : '취소'}
                          </button>
                        )}
                        {isReversed && <span className="ta-sub">취소됨</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>표시 {shown.length}건 합계</td>
                  <td className="ta-num ta-in">{fmtSigned(totals.bankIn)}</td>
                  <td className="ta-num ta-out">{fmtSigned(totals.bankOut)}</td>
                  <td colSpan={4}></td>
                  <td className={`ta-num ${totals.pnl >= 0 ? 'ta-in' : 'ta-out'}`}>{fmtSigned(totals.pnl)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="ta-footer-note">
        <b>고객원장</b> 행은 고객계좌(신)에 기록될 때 자동으로 옮겨진 것입니다 (충전 → 통장 +, 구매 → 1688 지급분만 통장 −·서비스비는 자산 +,
        환불 → 판매자 환불분 통장 +·서비스비 자산 −). 잔고 세 열은 <b>기록 순서</b> 기준 스냅샷이라, 적용일을 과거로 잡은 행은 그 행 이전 잔고를 보여줍니다.
        회사 행의 [취소]는 반대 방향 행을 추가하며 원본은 지우지 않습니다. hilili 그룹은 1차 집계에서 제외되어 있습니다.
      </p>
    </>
  );
};

export default LedgerTab;
