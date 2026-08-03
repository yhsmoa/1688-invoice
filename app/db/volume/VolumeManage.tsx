'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { dbAccessHeaders } from '../../../component/DbAccessGate';
import './VolumeManage.css';

// ============================================================
// 물량관리 — 주간(월~일) 출고·입고·근무시간 및 시간당 처리 지표
//   데이터: GET /api/db/volume-weekly
//     · 출고량     ft_shipment_details.quantity
//     · 입고량     ft_fulfillment_inbounds (ARRIVAL)
//     · 취소·반품  ft_fulfillment_inbounds (CANCEL, RETURN)
//     · 근무시간   invoiceManager_emplyee_records.total_minutes (직책별 분리)
//
//   파생 지표 (분모 = 선택한 직책의 근무시간)
//     · 출고/h   = 출고량 ÷ 시간
//     · 총처리/h = (입고 + 출고 + 취소·반품) ÷ 시간
//     · 라인/h   = (입고행 + 출고행) ÷ 시간  — 스캔 노동은 수량보다 행 수에 비례
// ============================================================

// ── 타입 ──
type Basis = 'shipment' | 'confirmed';
type Denom = 'all' | 'packInspect' | 'pack';
type Period = 'week' | 'month';

interface WeekRow {
  weekStart: string;
  weekEnd: string;
  shipmentQty: number;
  shipmentRows: number;
  arrivalQty: number;
  arrivalRows: number;
  cancelReturnQty: number;
  workMinutes: number;
  packMinutes: number;
  inspectMinutes: number;
  workDays: number;
  workerCount: number;
}

interface Meta {
  weekCount: number;
  detailRows: number;
  inboundRows: number;
  skippedDetails: number;
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

const DENOM_LABEL: Record<Denom, string> = {
  all: '전체',
  packInspect: '포장+검수',
  pack: '포장만',
};

const PERIOD_LABEL: Record<Period, string> = {
  week: '주간',
  month: '월간',
};

// ── 분모(선택 직책)의 분 수 ──
const minutesOf = (w: WeekRow, denom: Denom): number =>
  denom === 'all' ? w.workMinutes : denom === 'packInspect' ? w.packMinutes + w.inspectMinutes : w.packMinutes;

// ── 주간 파생 지표 ──
interface DerivedRow extends WeekRow {
  hours: number;
  totalHandledQty: number;
  totalLines: number;
  qtyPerHour: number | null;
  handledPerHour: number | null;
  linesPerHour: number | null;
}

const VolumeManage: React.FC = () => {
  const [basis, setBasis] = useState<Basis>('shipment');
  const [period, setPeriod] = useState<Period>('week');
  const [denom, setDenom] = useState<Denom>('all');
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 데이터 조회 ──
  const load = useCallback(async (b: Basis, p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/volume-weekly?basis=${b}&period=${p}`, {
        headers: dbAccessHeaders(),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '조회 실패');
      setWeeks(json.weeks || []);
      setMeta(json.meta || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.');
      setWeeks([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(basis, period);
  }, [basis, period, load]);

  // ── 파생 지표 계산 (분모 선택 반영) ──
  const rows: DerivedRow[] = useMemo(
    () =>
      weeks.map((w) => {
        const hours = minutesOf(w, denom) / 60;
        const totalHandledQty = w.arrivalQty + w.shipmentQty + w.cancelReturnQty;
        const totalLines = w.arrivalRows + w.shipmentRows;
        return {
          ...w,
          hours: round1(hours),
          totalHandledQty,
          totalLines,
          qtyPerHour: hours > 0 ? round1(w.shipmentQty / hours) : null,
          handledPerHour: hours > 0 ? round1(totalHandledQty / hours) : null,
          linesPerHour: hours > 0 ? round1(totalLines / hours) : null,
        };
      }),
    [weeks, denom]
  );

  // ── 합계 ──
  const totals = useMemo(() => {
    const shipmentQty = rows.reduce((n, w) => n + w.shipmentQty, 0);
    const arrivalQty = rows.reduce((n, w) => n + w.arrivalQty, 0);
    const cancelReturnQty = rows.reduce((n, w) => n + w.cancelReturnQty, 0);
    const handledQty = rows.reduce((n, w) => n + w.totalHandledQty, 0);
    const lines = rows.reduce((n, w) => n + w.totalLines, 0);
    const minutes = rows.reduce((n, w) => n + minutesOf(w, denom), 0);
    const hours = minutes / 60;
    return {
      shipmentQty,
      arrivalQty,
      cancelReturnQty,
      handledQty,
      hours: round1(hours),
      qtyPerHour: hours > 0 ? round1(shipmentQty / hours) : null,
      handledPerHour: hours > 0 ? round1(handledQty / hours) : null,
      linesPerHour: hours > 0 ? round1(lines / hours) : null,
    };
  }, [rows, denom]);

  // ── 막대 그래프 기준값 (최대 시간당 출고량) ──
  const maxPerHour = useMemo(() => rows.reduce((m, w) => Math.max(m, w.qtyPerHour ?? 0), 0), [rows]);

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="vm-main">
          {/* ── 페이지 헤더 ── */}
          <div className="vm-page-header">
            <h1 className="vm-page-title">물량관리</h1>
            <div className="vm-controls">
              <div className="vm-basis">
                <span className="vm-basis-label">단위</span>
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                  <button
                    key={p}
                    className={`vm-basis-btn ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {PERIOD_LABEL[p]}
                  </button>
                ))}
              </div>
              <div className="vm-basis">
                <span className="vm-basis-label">기준일</span>
                <button
                  className={`vm-basis-btn ${basis === 'shipment' ? 'active' : ''}`}
                  onClick={() => setBasis('shipment')}
                >
                  출고일
                </button>
                <button
                  className={`vm-basis-btn ${basis === 'confirmed' ? 'active' : ''}`}
                  onClick={() => setBasis('confirmed')}
                >
                  확정일
                </button>
              </div>
              <div className="vm-basis">
                <span className="vm-basis-label">근무시간</span>
                {(Object.keys(DENOM_LABEL) as Denom[]).map((d) => (
                  <button
                    key={d}
                    className={`vm-basis-btn ${denom === d ? 'active' : ''}`}
                    onClick={() => setDenom(d)}
                  >
                    {DENOM_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── 요약 카드 ── */}
          {!loading && !error && rows.length > 0 && (
            <div className="vm-summary">
              <div className="vm-sum-card">
                <span className="vm-sum-label">총 출고량</span>
                <span className="vm-sum-value">{nf(totals.shipmentQty)}</span>
                <span className="vm-sum-unit">개</span>
              </div>
              <div className="vm-sum-card">
                <span className="vm-sum-label">총 입고량</span>
                <span className="vm-sum-value">{nf(totals.arrivalQty)}</span>
                <span className="vm-sum-unit">개 · 취소반품 {nf(totals.cancelReturnQty)}</span>
              </div>
              <div className="vm-sum-card">
                <span className="vm-sum-label">근무시간 ({DENOM_LABEL[denom]})</span>
                <span className="vm-sum-value">{nf(Math.round(totals.hours))}</span>
                <span className="vm-sum-unit">시간</span>
              </div>
              <div className="vm-sum-card vm-sum-card-accent">
                <span className="vm-sum-label">출고량 / 시간</span>
                <span className="vm-sum-value">{totals.qtyPerHour ?? '—'}</span>
                <span className="vm-sum-unit">개 / 시간</span>
              </div>
              <div className="vm-sum-card vm-sum-card-accent2">
                <span className="vm-sum-label">총처리량 / 시간</span>
                <span className="vm-sum-value">{totals.handledPerHour ?? '—'}</span>
                <span className="vm-sum-unit">입고+출고+취소반품</span>
              </div>
            </div>
          )}

          {/* ── 본문 ── */}
          <div className="vm-content">
            {loading && <div className="vm-state">불러오는 중...</div>}
            {error && !loading && <div className="vm-state vm-state-error">{error}</div>}
            {!loading && !error && rows.length === 0 && (
              <div className="vm-state">데이터가 없습니다.</div>
            )}

            {!loading && !error && rows.length > 0 && (
              <div className="vm-table-wrap">
                <table className="vm-table">
                  <thead>
                    <tr>
                      <th className="vm-col-week">{period === 'month' ? '월' : '주차'}</th>
                      <th className="vm-col-range">기간</th>
                      <th className="vm-col-num">출고량</th>
                      <th className="vm-col-num">입고량</th>
                      <th className="vm-col-num">취소·반품</th>
                      <th className="vm-col-num">총처리량</th>
                      <th className="vm-col-num">근무시간</th>
                      <th className="vm-col-num">인원</th>
                      <th className="vm-col-rate">출고/h</th>
                      <th className="vm-col-num">총처리/h</th>
                      <th className="vm-col-num">라인/h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w) => (
                      <tr key={w.weekStart}>
                        <td className="vm-col-week">{periodLabel(w.weekStart, period)}</td>
                        <td className="vm-col-range">
                          {shortDate(w.weekStart)} ~ {shortDate(w.weekEnd)}
                        </td>
                        <td className="vm-col-num vm-strong">{nf(w.shipmentQty)}</td>
                        <td className="vm-col-num">{nf(w.arrivalQty)}</td>
                        <td className="vm-col-num vm-muted">{nf(w.cancelReturnQty)}</td>
                        <td className="vm-col-num">{nf(w.totalHandledQty)}</td>
                        <td className="vm-col-num">{nf(w.hours)}</td>
                        <td className="vm-col-num vm-muted">{w.workerCount || '—'}</td>
                        <td className="vm-col-rate">
                          {w.qtyPerHour !== null ? (
                            <div className="vm-rate">
                              <span className="vm-rate-value">{w.qtyPerHour}</span>
                              <span
                                className="vm-rate-bar"
                                style={{
                                  width:
                                    maxPerHour > 0 ? `${(w.qtyPerHour / maxPerHour) * 100}%` : '0%',
                                }}
                              />
                            </div>
                          ) : (
                            <span className="vm-none">근무기록 없음</span>
                          )}
                        </td>
                        <td className="vm-col-num vm-accent">{w.handledPerHour ?? '—'}</td>
                        <td className="vm-col-num vm-muted">{w.linesPerHour ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 안내 ── */}
          <p className="vm-footer-note">
            출고량은 <code>ft_shipment_details.quantity</code>, 입고량·취소반품은{' '}
            <code>ft_fulfillment_inbounds</code>(ARRIVAL / CANCEL·RETURN), 근무시간은{' '}
            <code>invoiceManager_emplyee_records</code> 합계입니다. 주간은 월요일 시작(월~일),
            월간은 달력 월 기준으로 원본 날짜에서 직접 집계합니다(주간 합산이 아니므로 월 경계를
            걸친 주가 중복되지 않습니다). 기준일{' '}
            <b>출고일</b>은 <code>ft_shipments.date</code>, <b>확정일</b>은 <code>confirmed_at</code>
            (KST), 입고는 항상 스캔 시각(KST) 기준입니다. <b>총처리량</b> = 입고 + 출고 + 취소·반품,{' '}
            <b>라인/h</b> = (입고행 + 출고행) ÷ 근무시간 — 스캔 노동은 수량보다 행(라인) 수에
            비례하므로 실제 작업 속도에 가장 가깝습니다.
            {meta && meta.skippedDetails > 0 && (
              <span className="vm-warn"> · 기준일 없음으로 제외된 출고 {nf(meta.skippedDetails)}건</span>
            )}
          </p>
        </main>
      </div>
    </div>
  );
};

export default VolumeManage;
