'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PNL_UNIT_LABEL, fmtSigned, type PnlUnit, type TradePnlRow } from '../../../../lib/tradeLedger';
import { defaultRangeFor, useTradePnl } from '../hooks/useTradeApi';

// ============================================================
// ChartTab — 기간별 그래프 (주간 / 월별 / 일별)
//
//   한 번에 한 지표만 그린다 (단일 계열 → 범례 없음, 제목이 계열명).
//   · 흐름 지표(순이익·거래액·수익·비용) → 막대. 순이익은 0 기준 위/아래를 파랑/빨강으로 구분
//   · 잔고 지표(통장·회사자산 기말)     → 선 + 끝점
//   · 막대 ≤ 24px, 데이터 끝 4px 라운드, 격자는 실선 hairline, 라벨은 끝값·극값만
//   · hover/focus: 기간의 모든 지표를 한 툴팁에 (값 먼저, 이름 뒤)
//   · 표 보기 = [손익] 탭 (툴팁은 보조, 값은 표에서도 읽힌다)
// ============================================================

type MetricKey = 'net' | 'gmv' | 'income' | 'expense' | 'bank_end' | 'asset_end';

interface Metric {
  key: MetricKey;
  label: string;
  kind: 'bar' | 'line';
  /** 순이익처럼 음수가 의미 있는 지표 — 0 기준 양/음을 색으로 구분 */
  signed: boolean;
  value: (p: TradePnlRow) => number;
}

const METRICS: Metric[] = [
  { key: 'net',       label: '순이익',     kind: 'bar',  signed: true,  value: (p) => p.net },
  { key: 'gmv',       label: '거래액',     kind: 'bar',  signed: false, value: (p) => p.gmv },
  { key: 'income',    label: '수익',       kind: 'bar',  signed: true,  value: (p) => p.service_income + p.refund_service },
  { key: 'expense',   label: '비용',       kind: 'bar',  signed: false, value: (p) => -(p.payroll + p.utilities + p.other_expense) },
  { key: 'bank_end',  label: '통장잔고',   kind: 'line', signed: false, value: (p) => p.bank_end },
  { key: 'asset_end', label: '회사자산',   kind: 'line', signed: false, value: (p) => p.asset_end },
];

// ── 차트 크롬 (dataviz 참조 팔레트, 라이트) ──
const COLOR = {
  series: '#2a78d6',
  negative: '#e34948',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  muted: '#898781',
  ink: '#0b0b0b',
  ink2: '#52514e',
  surface: '#ffffff',
};

const PLOT_H = 260;
const MARGIN = { top: 24, right: 20, bottom: 30, left: 60 };
const BAR_MAX = 24;
const UNIT_ORDER: PnlUnit[] = ['week', 'month', 'day'];

const fmtAxis = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만`;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
};

const periodLabel = (p: string, unit: PnlUnit): string => {
  const [y, m, d] = p.split('-').map(Number);
  if (unit === 'month') return `${String(y).slice(2)}.${m}`;
  return `${m}/${d}`;
};

const periodTitle = (p: string, unit: PnlUnit): string => {
  const [y, m, d] = p.split('-').map(Number);
  if (unit === 'month') return `${y}년 ${m}월`;
  if (unit === 'week') return `${m}/${d} 주 (월~일)`;
  return `${y}.${m}.${d}`;
};

/** 보기 좋은 눈금 — 0 을 포함(막대)하거나 데이터 범위(선)를 4~5칸으로 */
function niceTicks(min: number, max: number, includeZero: boolean): number[] {
  let lo = includeZero ? Math.min(0, min) : min;
  let hi = includeZero ? Math.max(0, max) : max;
  if (hi === lo) { hi = lo + 1; lo = includeZero ? Math.min(0, lo) : lo - 1; }
  const span = hi - lo;
  const rough = span / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** 막대 path — 데이터 끝만 4px 라운드, 기준선 쪽은 직각 */
function barPath(x: number, yTop: number, yBottom: number, w: number, roundTop: boolean): string {
  const r = Math.min(4, w / 2, Math.abs(yBottom - yTop));
  if (roundTop) {
    return `M${x},${yBottom} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBottom} Z`;
  }
  return `M${x},${yTop} V${yBottom - r} Q${x},${yBottom} ${x + r},${yBottom} H${x + w - r} Q${x + w},${yBottom} ${x + w},${yBottom - r} V${yTop} Z`;
}

interface Props {
  tabSwitcher: React.ReactNode;
  refreshKey: number;
}

const ChartTab: React.FC<Props> = ({ tabSwitcher, refreshKey }) => {
  const [unit, setUnit] = useState<PnlUnit>('week');
  const [metricKey, setMetricKey] = useState<MetricKey>('net');
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  const range = useMemo(() => defaultRangeFor(unit), [unit]);
  const { periods, loading, error } = useTradePnl(unit, range.from, range.to, refreshKey);
  const metric = METRICS.find((m) => m.key === metricKey)!;

  // ── 컨테이너 폭 ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 데이터 (오래된 → 최신) ──
  const data = useMemo(
    () => [...periods].sort((a, b) => (a.period_start < b.period_start ? -1 : 1)).map((p) => ({ p, v: metric.value(p) })),
    [periods, metric],
  );

  const plotW = Math.max(80, width - MARGIN.left - MARGIN.right);
  // 막대는 0 기준선을 반드시 포함, 선(잔고)은 데이터 범위로 축을 잡아 변화가 보이게
  const values = data.map((d) => d.v);
  const vMin = values.length ? Math.min(...values) : 0;
  const vMax = values.length ? Math.max(...values) : 0;
  const ticks = metric.kind === 'bar'
    ? niceTicks(Math.min(vMin, 0), Math.max(vMax, 0), true)
    : niceTicks(vMin - (vMax - vMin) * 0.1, vMax + (vMax - vMin) * 0.1, false);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const yOf = (v: number) => MARGIN.top + ((yMax - v) / (yMax - yMin || 1)) * PLOT_H;
  const band = data.length > 0 ? plotW / data.length : plotW;
  const xCenter = (i: number) => MARGIN.left + band * i + band / 2;
  const barW = Math.min(BAR_MAX, Math.max(4, band - 6));
  const zeroY = yOf(0);

  // ── 직접 라벨: 마지막 값 + 절대값 최대(다르면) ──
  const lastIdx = data.length - 1;
  const extIdx = data.reduce((best, d, i) => (Math.abs(d.v) > Math.abs(data[best]?.v ?? -Infinity) ? i : best), 0);
  const labelIdx = new Set<number>([lastIdx, extIdx].filter((i) => i >= 0));

  // x축 라벨 밀도 — 겹치지 않게 최대 12개
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  const hovered = hover != null ? data[hover] : null;
  const height = MARGIN.top + PLOT_H + MARGIN.bottom;

  return (
    <>
      {/* ── 탭행: 왼쪽 탭 / 오른쪽 단위 ── */}
      <div className="ta-tabbar">
        {tabSwitcher}
        <div className="ta-filters">
          {UNIT_ORDER.map((u) => (
            <button key={u} className={`ta-chip ${unit === u ? 'active' : ''}`} onClick={() => setUnit(u)}>{PNL_UNIT_LABEL[u]}</button>
          ))}
        </div>
      </div>

      {/* ── 지표 선택 (한 줄, 차트 위) ── */}
      <div className="ta-filters ta-metric-row">
        {METRICS.map((m) => (
          <button key={m.key} className={`ta-chip ${metricKey === m.key ? 'active' : ''}`} onClick={() => { setMetricKey(m.key); setHover(null); }}>{m.label}</button>
        ))}
      </div>

      <div className={`ta-content ta-chart-card ${loading ? 'is-loading' : ''}`}>
        <div className="ta-chart-head">
          <span className="ta-chart-title">{metric.label} · {PNL_UNIT_LABEL[unit]}</span>
          <span className="ta-sub">{range.from} ~ {range.to} · 위안 · 표 보기는 [손익] 탭</span>
        </div>

        {error ? (
          <div className="ta-state ta-state--error">{error}</div>
        ) : data.length === 0 && !loading ? (
          <div className="ta-state">기간 안에 데이터가 없습니다.</div>
        ) : (
          <div className="ta-chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
            <svg width={width} height={height} role="img" aria-label={`${metric.label} ${PNL_UNIT_LABEL[unit]} 그래프`}>
              {/* 격자 + y 눈금 */}
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotW} y1={yOf(t)} y2={yOf(t)} stroke={t === 0 ? COLOR.baseline : COLOR.grid} strokeWidth={1} />
                  <text x={MARGIN.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={COLOR.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtAxis(t)}</text>
                </g>
              ))}

              {/* 막대 */}
              {metric.kind === 'bar' && data.map((d, i) => {
                const x = xCenter(i) - barW / 2;
                const yV = yOf(d.v);
                const neg = d.v < 0;
                const top = neg ? zeroY : yV;
                const bottom = neg ? yV : zeroY;
                if (Math.abs(bottom - top) < 0.5) return null;
                const fill = metric.signed && neg ? COLOR.negative : COLOR.series;
                return <path key={d.p.period_start} d={barPath(x, top, bottom, barW, !neg)} fill={fill} opacity={hover == null || hover === i ? 1 : 0.55} />;
              })}

              {/* 선 */}
              {metric.kind === 'line' && data.length > 0 && (
                <>
                  <path
                    d={data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xCenter(i)},${yOf(d.v)}`).join(' ')}
                    fill="none" stroke={COLOR.series} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  />
                  {data.map((d, i) => (labelIdx.has(i) || hover === i) && (
                    <circle key={d.p.period_start} cx={xCenter(i)} cy={yOf(d.v)} r={4} fill={COLOR.series} stroke={COLOR.surface} strokeWidth={2} />
                  ))}
                  {hover != null && (
                    <line x1={xCenter(hover)} x2={xCenter(hover)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} stroke={COLOR.baseline} strokeWidth={1} />
                  )}
                </>
              )}

              {/* 직접 라벨 (끝값·극값만) */}
              {data.map((d, i) => labelIdx.has(i) && (
                <text
                  key={`l-${d.p.period_start}`}
                  x={xCenter(i)}
                  y={metric.kind === 'bar' ? (d.v < 0 ? yOf(d.v) + 14 : yOf(d.v) - 6) : yOf(d.v) - 10}
                  textAnchor="middle" fontSize={11} fontWeight={600} fill={COLOR.ink2}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtSigned(d.v)}
                </text>
              ))}

              {/* x 축 라벨 */}
              {data.map((d, i) => (i % labelEvery === 0 || i === lastIdx) && (
                <text key={`x-${d.p.period_start}`} x={xCenter(i)} y={MARGIN.top + PLOT_H + 18} textAnchor="middle" fontSize={11} fill={COLOR.muted}>
                  {periodLabel(d.p.period_start, unit)}
                </text>
              ))}

              {/* hover/focus 히트 영역 — 마크보다 크게(밴드 전체) */}
              {data.map((d, i) => (
                <rect
                  key={`h-${d.p.period_start}`}
                  x={MARGIN.left + band * i} y={MARGIN.top} width={band} height={PLOT_H}
                  fill="transparent" tabIndex={0}
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  aria-label={`${periodTitle(d.p.period_start, unit)} ${metric.label} ${fmtSigned(d.v)}`}
                />
              ))}
            </svg>

            {/* 툴팁 — 기간의 모든 지표, 값 먼저 */}
            {hovered && hover != null && (
              <div
                className="ta-tooltip"
                style={{ left: Math.min(xCenter(hover) + 12, width - 210), top: MARGIN.top }}
              >
                <div className="ta-tooltip-title">{periodTitle(hovered.p.period_start, unit)}</div>
                {METRICS.map((m) => (
                  <div key={m.key} className={`ta-tooltip-row ${m.key === metric.key ? 'is-current' : ''}`}>
                    <span className="ta-tooltip-value">{fmtSigned(m.value(hovered.p))}</span>
                    <span className="ta-tooltip-label">{m.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="ta-footer-note">
        <b>순이익</b>은 0 기준 위(파랑)/아래(빨강)로 표시합니다. <b>비용</b>은 급여 + 공과금 + 기타경비의 크기, <b>수익</b>은 서비스비 수익 − 환불된 서비스비입니다.
        통장잔고·회사자산은 각 기간 마지막 기록의 스냅샷입니다. 주간은 월요일 시작, 최근 16주 · 월별 최근 12개월 · 일별 최근 30일. 숫자는 [손익] 탭 표에서 그대로 볼 수 있습니다.
      </p>
    </>
  );
};

export default ChartTab;
