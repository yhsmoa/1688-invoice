'use client';

import React, { useEffect, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { fetchTodayRate } from '../../../lib/exchangeRate';
import { fmtYuan } from '../../../lib/tradeLedger';
import { useTradeStatus } from './hooks/useTradeApi';
import LedgerTab from './components/LedgerTab';
import PnlTab from './components/PnlTab';
import OpeningModal from './components/OpeningModal';
import ExpenseModal from './components/ExpenseModal';
import PayrollModal from './components/PayrollModal';
import './TradeAccount.css';

// ============================================================
// 무역계좌 — 회사 통장 원장
//   통장잔고 = 회사자산 + 고객 충전금(immong)
//   [계좌내역] 고객 원장 미러 + 회사 지출, 세 잔고 스냅샷
//   [손익]     월별/일별 순이익·이익률
//   데이터: /api/trade-account/* (DB 관리 접근 코드 필요)
// ============================================================

type Tab = 'ledger' | 'pnl';
const TAB_LABEL: Record<Tab, string> = { ledger: '계좌내역', pnl: '손익' };

const nearlyEqual = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.005;

const TradeAccount: React.FC = () => {
  const [tab, setTab] = useState<Tab>('ledger');
  const { status, loading, error, reload } = useTradeStatus();
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState<'opening' | 'expense' | 'payroll' | null>(null);
  const [todayRate, setTodayRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTodayRate()
      .then((r) => { if (!cancelled) setTodayRate(r.rate); })
      .catch(() => { if (!cancelled) setTodayRate(null); });
    return () => { cancelled = true; };
  }, []);

  /** 기록 후 공통 — 상태·목록 재조회 */
  const afterChange = () => {
    setModal(null);
    setRefreshKey((k) => k + 1);
    reload();
  };

  // ── 정합: 스냅샷 충전금 = 고객 원장 현재값, Σ통장Δ = 통장잔고 ──
  const consistent =
    !!status && status.opened &&
    nearlyEqual(status.customerBalance, status.ledgerCustomerBalance) &&
    nearlyEqual(status.sumBank, status.bankBalance);

  const groupNames = status?.groups.map((g) => g.name).join(', ') || '고객';

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="ta-main">
          {/* ── 헤더 ── */}
          <div className="ta-page-header">
            <div className="ta-title-group">
              <h1 className="ta-page-title">무역계좌</h1>
              <span className="ta-page-sub">통장잔고 = 회사자산 + 고객 충전금</span>
            </div>
            <div className="ta-actions">
              {status?.opened ? (
                <>
                  <button className="ta-btn" onClick={() => setModal('payroll')}>급여 반영</button>
                  <button className="ta-btn ta-btn--primary" onClick={() => setModal('expense')}>회사 거래 추가</button>
                </>
              ) : (
                !loading && !error && <button className="ta-btn ta-btn--primary" onClick={() => setModal('opening')}>이월 설정</button>
              )}
            </div>
          </div>

          {/* ── 상태 오류 ── */}
          {error && <div className="ta-alert ta-alert--error">상태 조회 실패 — {error}</div>}

          {/* ── 이월 전 안내 ── */}
          {!loading && !error && status && !status.opened && (
            <div className="ta-alert">
              아직 이월이 설정되지 않았습니다. 현재 통장잔고를 입력하면 그 시각의 고객 충전금을 빼서 회사자산을 정하고,
              이후 고객 원장의 모든 거래가 자동으로 여기에 기록됩니다.
            </div>
          )}

          {/* ── 요약 카드 ── */}
          {status?.opened && (
            <div className="ta-summary">
              <div className="ta-card ta-card--bank">
                <span className="ta-card-label">통장잔고</span>
                <span className="ta-card-value">{fmtYuan(status.bankBalance)}</span>
                <span className="ta-card-unit">{todayRate != null && status.bankBalance != null ? `≈ ₩${Math.round(status.bankBalance * todayRate).toLocaleString()} (금일 환율)` : '위안'}</span>
              </div>
              <div className="ta-card">
                <span className="ta-card-label">고객 충전금 ({groupNames})</span>
                <span className="ta-card-value">{fmtYuan(status.customerBalance)}</span>
                <span className="ta-card-unit">고객 원장 현재 {fmtYuan(status.ledgerCustomerBalance)}</span>
              </div>
              <div className="ta-card ta-card--accent">
                <span className="ta-card-label">회사자산</span>
                <span className="ta-card-value">{fmtYuan(status.assetBalance)}</span>
                <span className="ta-card-unit">통장 − 충전금</span>
              </div>
              <div className={`ta-card ${consistent ? 'ta-card--ok' : 'ta-card--warn'}`}>
                <span className="ta-card-label">정합</span>
                <span className="ta-card-value">{consistent ? '✓' : '⚠'}</span>
                <span className="ta-card-unit">
                  {consistent
                    ? `${status.rowCount}행 · 이월 ${status.startedAt ? status.startedAt.slice(0, 10) : ''}`
                    : `충전금 스냅샷 ${fmtYuan(status.customerBalance)} vs 원장 ${fmtYuan(status.ledgerCustomerBalance)} · Σ통장 ${fmtYuan(status.sumBank)}`}
                </span>
              </div>
            </div>
          )}

          {/* ── 탭 ── */}
          {status?.opened && (
            <>
              <div className="ta-tabs" role="tablist">
                {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={`ta-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
              {tab === 'ledger'
                ? <LedgerTab refreshKey={refreshKey} onChanged={afterChange} todayRate={todayRate} />
                : <PnlTab refreshKey={refreshKey} />}
            </>
          )}
        </main>
      </div>

      {modal === 'opening' && <OpeningModal onClose={() => setModal(null)} onOpened={afterChange} />}
      {modal === 'expense' && <ExpenseModal onClose={() => setModal(null)} onSaved={afterChange} />}
      {modal === 'payroll' && <PayrollModal onClose={() => setModal(null)} onSaved={afterChange} />}
    </div>
  );
};

export default TradeAccount;
