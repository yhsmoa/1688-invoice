'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { dbAccessHeaders } from '../../../component/DbAccessGate';
import './OrderDataManage.css';

// ============================================================
// 주문 데이터 관리 — 주간(월~일) 주문량 집계
//   데이터: GET /api/db/order-weekly
//     · 주차 기준 ft_orders.created_at (KST)
//     · 주문수량 ft_order_items.order_qty 합
//     · 배송유형 ft_order_items.shipment_type
//     · 잠재 주문량 ft_carts ORDER(주문요청) / NEW(카트) — 오늘이 속한 구간 막대에 이어 표시
// ============================================================

// ── 타입 ──
type Period = 'week' | 'month';

interface WeekRow {
  weekStart: string;
  weekEnd: string;
  orderCount: number;
  userCount: number;
  itemRows: number;
  qty: number;
  coupangQty: number;
  personalQty: number;
  directQty: number;
  doneQty: number;
  amountCny: number;
}

interface Meta {
  weekCount: number;
  orderRows: number;
  itemRows: number;
  orphanItems: number;
  headerQtyMismatch: number;
}

/** 아직 ft_orders 로 넘어오지 않은 고객 카트 집계 */
interface PendingStat {
  carts: number;
  items: number;
  qty: number;
}

interface Pending {
  periodStart: string;
  request: PendingStat;
  cart: PendingStat;
}

// ── 표시 helper ──
const nf = (n: number) => n.toLocaleString('ko-KR');
const round1 = (n: number) => Math.round(n * 10) / 10;

/** '2026-07-27' → '07.27' */
const shortDate = (d: string) => d.slice(5).replace('-', '.');

/** 구간 라벨 — 주간: '{월}월 {n}주차'(그 달 첫 월요일 기준) / 월간: '{연}년 {월}월' */
const periodLabel = (periodStart: string, period: Period): string => {
  const [y, m, d] = periodStart.split('-').map(Number);
  if (period === 'month') return `${y}년 ${m}월`;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = first.getUTCDay();
  const offsetToMonday = firstDow === 0 ? 1 : firstDow === 1 ? 0 : 8 - firstDow;
  const firstMonday = 1 + offsetToMonday;
  const nth = Math.floor((d - firstMonday) / 7) + 1;
  return nth >= 1 ? `${m}월 ${nth}주차` : `${m}월 1주차`;
};

const PERIOD_LABEL: Record<Period, string> = {
  week: '주간',
  month: '월간',
};

const OrderDataManage: React.FC = () => {
  const [period, setPeriod] = useState<Period>('week');
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 데이터 조회 ──
  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/order-weekly?period=${p}`, {
        headers: dbAccessHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '조회 실패');
      setWeeks(json.weeks || []);
      setMeta(json.meta || null);
      setPending(json.pending || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.');
      setWeeks([]);
      setMeta(null);
      setPending(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  // ── 합계 ──
  const totals = useMemo(() => {
    const qty = weeks.reduce((n, w) => n + w.qty, 0);
    const orderCount = weeks.reduce((n, w) => n + w.orderCount, 0);
    const itemRows = weeks.reduce((n, w) => n + w.itemRows, 0);
    const coupangQty = weeks.reduce((n, w) => n + w.coupangQty, 0);
    const personalQty = weeks.reduce((n, w) => n + w.personalQty, 0);
    const directQty = weeks.reduce((n, w) => n + w.directQty, 0);
    const doneQty = weeks.reduce((n, w) => n + w.doneQty, 0);
    const amountCny = weeks.reduce((n, w) => n + w.amountCny, 0);
    return {
      qty,
      orderCount,
      itemRows,
      coupangQty,
      personalQty,
      directQty,
      doneQty,
      amountCny,
      avgQtyPerWeek: weeks.length > 0 ? Math.round(qty / weeks.length) : 0,
      donePct: qty > 0 ? round1((doneQty / qty) * 100) : null,
    };
  }, [weeks]);

  // ── 잠재 주문량 (주문요청 + 카트) — 오늘이 속한 구간 행에만 얹는다 ──
  const pendingQty = pending ? pending.request.qty + pending.cart.qty : 0;
  const pendingOf = useCallback(
    (weekStart: string) => (pending && pendingQty > 0 && pending.periodStart === weekStart ? pending : null),
    [pending, pendingQty]
  );

  // ── 막대 그래프 기준값 (주문수량 + 해당 행의 잠재 주문량 중 최대) ──
  const maxQty = useMemo(
    () =>
      weeks.reduce((m, w) => {
        const p = pendingOf(w.weekStart);
        return Math.max(m, w.qty + (p ? p.request.qty + p.cart.qty : 0));
      }, 0),
    [weeks, pendingOf]
  );
  const barPct = (n: number) => (maxQty > 0 ? `${(n / maxQty) * 100}%` : '0%');

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="odm-main">
          {/* ── 페이지 헤더 ── */}
          <div className="odm-page-header">
            <div className="odm-page-title-wrap">
              <h1 className="odm-page-title">주문 데이터 관리</h1>
              <span className="odm-page-sub">
                {period === 'month' ? '월별 주문량' : '주간별 주문량 (월~일)'}
              </span>
            </div>
            <div className="odm-period">
              <span className="odm-period-label">단위</span>
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <button
                  key={p}
                  className={`odm-period-btn ${period === p ? 'active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          {/* ── 요약 카드 ── */}
          {!loading && !error && weeks.length > 0 && (
            <div className="odm-summary">
              <div className="odm-sum-card">
                <span className="odm-sum-label">총 주문수량</span>
                <span className="odm-sum-value">{nf(totals.qty)}</span>
                <span className="odm-sum-unit">개 · 품목 {nf(totals.itemRows)}건</span>
              </div>
              <div className="odm-sum-card">
                <span className="odm-sum-label">총 주문건수</span>
                <span className="odm-sum-value">{nf(totals.orderCount)}</span>
                <span className="odm-sum-unit">건</span>
              </div>
              <div className="odm-sum-card odm-sum-card-accent">
                <span className="odm-sum-label">{period === 'month' ? '월' : '주'} 평균 주문량</span>
                <span className="odm-sum-value">{nf(totals.avgQtyPerWeek)}</span>
                <span className="odm-sum-unit">
                  개 / {period === 'month' ? '월' : '주'} · {weeks.length}
                  {period === 'month' ? '개월' : '주'}
                </span>
              </div>
              <div className="odm-sum-card">
                <span className="odm-sum-label">쿠팡 비중</span>
                <span className="odm-sum-value">
                  {totals.qty > 0 ? round1((totals.coupangQty / totals.qty) * 100) : 0}
                  <span className="odm-sum-pct">%</span>
                </span>
                <span className="odm-sum-unit">{nf(totals.coupangQty)}개</span>
              </div>
              <div className="odm-sum-card odm-sum-card-accent2">
                <span className="odm-sum-label">주문 금액</span>
                <span className="odm-sum-value">{nf(totals.amountCny)}</span>
                <span className="odm-sum-unit">CNY</span>
              </div>
              {pending && (
                <div className="odm-sum-card odm-sum-card-pending">
                  <span className="odm-sum-label">잠재 주문량 (미주문)</span>
                  <span className="odm-sum-value">{nf(pendingQty)}</span>
                  <span className="odm-sum-unit">
                    주문요청 {nf(pending.request.qty)} · 카트 {nf(pending.cart.qty)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── 본문 ── */}
          <div className="odm-content">
            {loading && <div className="odm-state">불러오는 중...</div>}
            {error && !loading && <div className="odm-state odm-state-error">{error}</div>}
            {!loading && !error && weeks.length === 0 && (
              <div className="odm-state">데이터가 없습니다.</div>
            )}

            {/* ── 막대 범례 ── */}
            {!loading && !error && weeks.length > 0 && (
              <div className="odm-legend">
                <span className="odm-legend-item">
                  <i className="odm-legend-swatch odm-seg-order" />
                  주문
                </span>
                <span className="odm-legend-item">
                  <i className="odm-legend-swatch odm-seg-request" />
                  주문요청
                </span>
                <span className="odm-legend-item">
                  <i className="odm-legend-swatch odm-seg-cart" />
                  카트
                </span>
                <span className="odm-legend-note">
                  주문요청·카트는 아직 주문되지 않은 잠재 주문량으로, 이번 {period === 'month' ? '달' : '주'} 막대에 이어 표시
                </span>
              </div>
            )}

            {!loading && !error && weeks.length > 0 && (
              <div className="odm-table-wrap">
                <table className="odm-table">
                  <thead>
                    <tr>
                      <th className="odm-col-week">{period === 'month' ? '월' : '주차'}</th>
                      <th className="odm-col-range">기간</th>
                      <th className="odm-col-num">주문건수</th>
                      <th className="odm-col-num">품목수</th>
                      <th className="odm-col-bar">주문수량</th>
                      <th className="odm-col-type">쿠팡</th>
                      <th className="odm-col-type">개인통관</th>
                      <th className="odm-col-type">직배송</th>
                      <th className="odm-col-num">금액(CNY)</th>
                      <th className="odm-col-num">완료율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => {
                      const donePct = w.qty > 0 ? round1((w.doneQty / w.qty) * 100) : null;
                      const p = pendingOf(w.weekStart);
                      return (
                        <tr key={w.weekStart} className={p ? 'odm-row-pending' : undefined}>
                          <td className="odm-col-week">{periodLabel(w.weekStart, period)}</td>
                          <td className="odm-col-range">
                            {shortDate(w.weekStart)} ~ {shortDate(w.weekEnd)}
                          </td>
                          <td className="odm-col-num">{nf(w.orderCount)}</td>
                          <td className="odm-col-num odm-muted">{nf(w.itemRows)}</td>
                          {/* 주문수량 막대 — 주문(실적) 뒤에 주문요청·카트(잠재)를 이어 붙인다 */}
                          <td className="odm-col-bar">
                            <div className="odm-bar-cell">
                              <span className="odm-bar-value">{nf(w.qty)}</span>
                              <span className="odm-bar-track">
                                <span className="odm-bar-seg odm-seg-order" style={{ width: barPct(w.qty) }} />
                                {p && (
                                  <>
                                    <span
                                      className="odm-bar-seg odm-seg-request"
                                      style={{ width: barPct(p.request.qty) }}
                                      title={`주문요청 ${nf(p.request.qty)}개`}
                                    />
                                    <span
                                      className="odm-bar-seg odm-seg-cart"
                                      style={{ width: barPct(p.cart.qty) }}
                                      title={`카트 ${nf(p.cart.qty)}개`}
                                    />
                                  </>
                                )}
                              </span>
                            </div>
                            {p && (
                              <div className="odm-bar-pending">
                                <span className="odm-pending-request">주문요청 +{nf(p.request.qty)}</span>
                                <span className="odm-pending-cart">카트 +{nf(p.cart.qty)}</span>
                              </div>
                            )}
                          </td>
                          {/* 배송유형 — 수량 옆에 해당 구간 주문수량 대비 비중 표시 */}
                          <td className="odm-col-type">
                            {nf(w.coupangQty)}
                            {w.qty > 0 && (
                              <span className="odm-pct"> ({round1((w.coupangQty / w.qty) * 100)}%)</span>
                            )}
                          </td>
                          <td className="odm-col-type">
                            {nf(w.personalQty)}
                            {w.qty > 0 && (
                              <span className="odm-pct"> ({round1((w.personalQty / w.qty) * 100)}%)</span>
                            )}
                          </td>
                          <td className="odm-col-type odm-muted">
                            {nf(w.directQty)}
                            {w.qty > 0 && (
                              <span className="odm-pct"> ({round1((w.directQty / w.qty) * 100)}%)</span>
                            )}
                          </td>
                          <td className="odm-col-num odm-muted">{nf(w.amountCny)}</td>
                          <td className="odm-col-num">
                            {donePct !== null ? (
                              <span className={donePct >= 99.9 ? 'odm-done' : 'odm-progress'}>
                                {donePct}%
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 안내 ── */}
          <p className="odm-footer-note">
            구간은 <code>ft_orders.created_at</code>(KST) 기준이며, 주간은 월요일 시작(월~일), 월간은
            달력 월 기준으로 원본 날짜에서 직접 집계합니다(주간 합산이 아니므로 월 경계를 걸친 주가
            중복되지 않습니다). 주문수량은 <code>ft_order_items.order_qty</code> 합계, 완료율은 품목
            상태가 <code>DONE</code>인 수량의 비율입니다. 잠재 주문량은 <code>ft_carts</code> 상태가{' '}
            <code>ORDER</code>(주문요청)·<code>NEW</code>(카트)인 카트의 품목 수량 합계이며, 주문으로
            불러오는 시점이 주문일이 되므로 오늘이 속한 구간에 표시하고 합계·평균·비중에는 넣지 않습니다.
            {meta && meta.headerQtyMismatch > 0 && (
              <span className="odm-warn">
                {' '}
                · <b>주의</b>: <code>ft_orders.total_qty</code>(헤더 수량)가 품목 합계와 다른 주문이{' '}
                {nf(meta.headerQtyMismatch)}건 있어, 집계는 품목 기준으로 계산했습니다.
              </span>
            )}
            {meta && meta.orphanItems > 0 && (
              <span className="odm-warn"> · 주문 정보가 없어 제외된 품목 {nf(meta.orphanItems)}건</span>
            )}
          </p>
        </main>
      </div>
    </div>
  );
};

export default OrderDataManage;
