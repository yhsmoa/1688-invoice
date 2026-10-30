'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  DENOM_LABEL,
  INCOMING_STAGES,
  STAGE_LABEL,
  bucketWaitHist,
  computeCapacity,
  computeInflow,
  dayOfWeek,
  headcountTable,
  simulateClear,
  type CapacityDenom,
  type PipelineData,
  type PipelineStage,
  type SimInput,
} from '../../../../lib/volumeForecast';
import { useVolumeForecast } from '../hooks/useVolumeForecast';
import { dayLabel, formatKstDateTime } from '../utils/periodLabel';

// ============================================================
// [물량예측] 탭 — 파이프라인 · 처리 능력 · 소진 예측 · 유입 예측 · 확인 필요
//
//   A. 지금 파이프라인  PROCESSING 수량을 다섯 칸으로 (앞으로 들어올 / 들어와 있는)
//   B. 처리 능력·소진   최근 28일 실측 인원·속도 → 지금 속도면 며칠, 인원을 바꾸면 며칠
//   C. 유입 예측        미입고 물량이 날짜별로 얼마나 입고될지 (소요일 분포 기반, 14일)
//   D. 확인 필요        배송완료 7일 지났는데 입고 스캔이 없는 항목
//
//   데이터: GET /api/db/volume-forecast (rpc db_volume_pipeline) — 계산은 lib/volumeForecast
// ============================================================

const nf = (n: number) => Math.round(n).toLocaleString('ko-KR');
const nf1 = (n: number) =>
  n.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** 마지막 배송상황 업로드가 이 일수보다 오래되면 경고 (처리속도 탭과 동일) */
const DELIVERY_UPLOAD_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

/** 유입 예측 기간 */
const INFLOW_HORIZON_DAYS = 14;

/** 입력 문자열 → 양수 (아니면 0) */
const toNum = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 'YYYY-MM-DD' 의 경과일 (오늘 기준) */
const daysSince = (iso: string, today: string): number =>
  Math.floor((Date.parse(`${today}T00:00:00+09:00`) - Date.parse(iso)) / DAY_MS);

interface ForecastTabProps {
  /** 탭 선택 버튼 — 컨트롤 줄 왼쪽에 배치 (VolumeManage 가 전달) */
  tabSwitcher: React.ReactNode;
}

const ForecastTab: React.FC<ForecastTabProps> = ({ tabSwitcher }) => {
  const { data, loading, error, reload } = useVolumeForecast();
  const [denom, setDenom] = useState<CapacityDenom>('all');

  // ── 처리 능력 (실측) ──
  const capacity = useMemo(
    () => (data ? computeCapacity(data.capacity_days, denom) : null),
    [data, denom]
  );

  // ── 입력값: 인원 · 인당 근무시간 · 라인/인시 — 기본은 실측, 바꾸면 즉시 재계산 ──
  const [people, setPeople] = useState('');
  const [hours, setHours] = useState('');
  const [lph, setLph] = useState('');
  useEffect(() => {
    if (!capacity) return;
    setPeople(String(Math.round(capacity.avgPeople)));
    setHours(capacity.hoursPerPersonDay.toFixed(1));
    setLph(capacity.linesPerPersonHour.toFixed(1));
  }, [capacity]);

  // ── 유입 예측 ──
  const inflow = useMemo(() => (data ? computeInflow(data, INFLOW_HORIZON_DAYS) : null), [data]);

  // ── 소진 시뮬레이션 ──
  const simBase = useMemo<Omit<SimInput, 'people'> | null>(() => {
    if (!data || !inflow) return null;
    return {
      today: data.meta.today,
      backlogPackRows: data.snapshot.stages.arrived_waiting.items,
      inflowRows: inflow.days.map((d) => d.rows),
      hoursPerPersonDay: toNum(hours),
      linesPerPersonHour: toNum(lph),
    };
  }, [data, inflow, hours, lph]);

  const peopleNum = Math.round(toNum(people));
  const sim = useMemo(
    () => (simBase && peopleNum > 0 ? simulateClear({ ...simBase, people: peopleNum }) : null),
    [simBase, peopleNum]
  );
  const table = useMemo(
    () => (simBase && peopleNum > 0 ? headcountTable(simBase, peopleNum) : []),
    [simBase, peopleNum]
  );

  const waitBuckets = useMemo(() => (data ? bucketWaitHist(data.snapshot.wait_hist) : []), [data]);

  // ── 합계 ──
  const sumStages = (d: PipelineData, keys: readonly PipelineStage[]) =>
    keys.reduce(
      (acc, k) => ({ items: acc.items + d.snapshot.stages[k].items, qty: acc.qty + d.snapshot.stages[k].qty }),
      { items: 0, qty: 0 }
    );

  const uploadStale =
    !data?.meta.last_upload_at ||
    Date.now() - new Date(data.meta.last_upload_at).getTime() > DELIVERY_UPLOAD_STALE_DAYS * DAY_MS;

  return (
    <>
      {/* ── 컨트롤 줄: 왼쪽 탭 선택 / 오른쪽 근무시간 분모 · 새로고침 ── */}
      <div className="vm-toolbar">
        {tabSwitcher}
        <div className="vm-controls">
          <div className="vm-basis">
            <span className="vm-basis-label">근무시간</span>
            {(Object.keys(DENOM_LABEL) as CapacityDenom[]).map((d) => (
              <button
                key={d}
                className={`vm-basis-btn ${denom === d ? 'active' : ''}`}
                onClick={() => setDenom(d)}
              >
                {DENOM_LABEL[d]}
              </button>
            ))}
          </div>
          <button className="vm-basis-btn" onClick={reload} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {loading && <div className="vm-state">불러오는 중...</div>}
      {error && !loading && <div className="vm-state vm-state-error">{error}</div>}

      {!loading && !error && data && capacity && inflow && (
        <>
          {/* ── 배송상황 업로드 상태 (미발송/배송중/배송완료 판정의 근거) ── */}
          <div className={`vm-speed-upload ${uploadStale ? 'vm-speed-upload--stale' : ''}`}>
            마지막 배송상황 업로드:{' '}
            <b>{data.meta.last_upload_at ? formatKstDateTime(data.meta.last_upload_at) : '기록 없음'}</b>
            {uploadStale && ` — ${DELIVERY_UPLOAD_STALE_DAYS}일 넘게 업로드되지 않아 미발송·배송중·배송완료 구분이 낡았습니다.`}
          </div>

          {/* ============================================================
              A. 지금 파이프라인
              ============================================================ */}
          <div className="vm-section">
            <h2 className="vm-section-title">
              지금 파이프라인 <span className="vm-section-sub">진행중 주문의 수량이 어디에 있나 (오늘 {data.meta.today})</span>
            </h2>
          </div>
          <div className="vm-summary">
            {INCOMING_STAGES.map((s) => (
              <div key={s} className="vm-sum-card">
                <span className="vm-sum-label">{STAGE_LABEL[s]}</span>
                <span className="vm-sum-value">{nf(data.snapshot.stages[s].qty)}</span>
                <span className="vm-sum-unit">개 · {nf(data.snapshot.stages[s].items)}행</span>
              </div>
            ))}
            {(() => {
              const inc = sumStages(data, INCOMING_STAGES);
              return (
                <div className="vm-sum-card vm-sum-card-accent">
                  <span className="vm-sum-label">앞으로 들어올 물량</span>
                  <span className="vm-sum-value">{nf(inc.qty)}</span>
                  <span className="vm-sum-unit">개 · {nf(inc.items)}행 · 1688 주문했지만 미입고</span>
                </div>
              );
            })()}
          </div>
          <div className="vm-summary">
            <div className="vm-sum-card vm-sum-card-accent2 vm-sum-card-wide">
              <span className="vm-sum-label">들어와 있는 물량 — {STAGE_LABEL.arrived_waiting}</span>
              <span className="vm-sum-value">{nf(data.snapshot.stages.arrived_waiting.qty)}</span>
              <span className="vm-sum-unit">개 · {nf(data.snapshot.stages.arrived_waiting.items)}행 · 마지막 입고 스캔 후 기다린 날</span>
              <div className="vm-wait">
                {waitBuckets.map((b) => {
                  const max = Math.max(...waitBuckets.map((x) => x.qty), 1);
                  return (
                    <div key={b.key} className={`vm-wait-item ${b.key === '7-13' || b.key === '14+' ? 'is-old' : ''}`}>
                      <span className="vm-wait-label">{b.label}</span>
                      <span className="vm-wait-bar">
                        <span className="vm-wait-fill" style={{ width: `${(b.qty / max) * 100}%` }} />
                      </span>
                      <span className="vm-wait-num">{nf(b.qty)}개 · {nf(b.items)}행</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="vm-sum-card">
              <span className="vm-sum-label">{STAGE_LABEL.packed_waiting}</span>
              <span className="vm-sum-value">{nf(data.snapshot.stages.packed_waiting.qty)}</span>
              <span className="vm-sum-unit">개 · {nf(data.snapshot.stages.packed_waiting.items)}행 · 출고일(화·목)에 나감</span>
            </div>
          </div>

          {/* ============================================================
              B. 처리 능력 · 소진 예측
              ============================================================ */}
          <div className="vm-section">
            <h2 className="vm-section-title">
              지금 인원·속도면 며칠 걸리나{' '}
              <span className="vm-section-sub">최근 28일 근무일 {capacity.workDays}일 실측 ({DENOM_LABEL[denom]} 근무시간 기준)</span>
            </h2>
            <div className="vm-inputs">
              <label className="vm-input-group">
                인원
                <input className="vm-input" type="number" min={1} step={1} value={people} onChange={(e) => setPeople(e.target.value)} />
                명
              </label>
              <label className="vm-input-group">
                인당 근무
                <input className="vm-input" type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
                시간/일
              </label>
              <label className="vm-input-group">
                처리속도
                <input className="vm-input" type="number" min={0.1} step={0.1} value={lph} onChange={(e) => setLph(e.target.value)} />
                라인/인시
              </label>
              <button
                className="vm-basis-btn"
                onClick={() => {
                  setPeople(String(Math.round(capacity.avgPeople)));
                  setHours(capacity.hoursPerPersonDay.toFixed(1));
                  setLph(capacity.linesPerPersonHour.toFixed(1));
                }}
              >
                실측값으로
              </button>
            </div>
          </div>
          <div className="vm-summary">
            <div className="vm-sum-card">
              <span className="vm-sum-label">하루 평균 인원</span>
              <span className="vm-sum-value">{nf1(capacity.avgPeople)}</span>
              <span className="vm-sum-unit">명 · 인당 {nf1(capacity.hoursPerPersonDay)}시간</span>
            </div>
            <div className="vm-sum-card">
              <span className="vm-sum-label">하루 평균 처리</span>
              <span className="vm-sum-value">{nf(capacity.avgLinesPerDay)}</span>
              <span className="vm-sum-unit">라인 · 입고 {nf(capacity.avgArrRowsPerDay)}행 + 포장 {nf(capacity.avgPackRowsPerDay)}행</span>
            </div>
            <div className="vm-sum-card">
              <span className="vm-sum-label">하루 평균 포장</span>
              <span className="vm-sum-value">{nf(capacity.avgPackQtyPerDay)}</span>
              <span className="vm-sum-unit">
                개 · 포장 대기 {nf(data.snapshot.stages.arrived_waiting.qty)}개 ÷ 하루 포장 ={' '}
                {capacity.avgPackQtyPerDay > 0 ? nf1(data.snapshot.stages.arrived_waiting.qty / capacity.avgPackQtyPerDay) : '—'}일
              </span>
            </div>
            <div className="vm-sum-card">
              <span className="vm-sum-label">처리속도 (중앙값)</span>
              <span className="vm-sum-value">{nf1(capacity.linesPerPersonHour)}</span>
              <span className="vm-sum-unit">라인 / 인·시간</span>
            </div>
            <div className={`vm-sum-card ${sim && sim.workDays == null ? 'vm-sum-card-warn' : 'vm-sum-card-accent'}`}>
              <span className="vm-sum-label">입력한 인원·속도로 밀린 물량 따라잡기까지</span>
              <span className="vm-sum-value">{sim?.workDays != null ? `${sim.workDays}` : sim ? '못 따라잡음' : '—'}</span>
              <span className="vm-sum-unit">
                {sim?.finishDate
                  ? `근무일 · ${dayLabel(sim.finishDate)} · 하루 처리 ${nf(sim.dailyCapacity)}라인 vs 하루 유입 약 ${nf(sim.avgInflowLinesPerWorkDay)}라인`
                  : sim
                    ? `${sim.horizonDays}일 안에 못 따라잡음 · 하루 처리 ${nf(sim.dailyCapacity)}라인 < 유입 약 ${nf(sim.avgInflowLinesPerWorkDay)}라인 — 밀림이 늘어남`
                    : '입력값을 확인하세요'}
              </span>
            </div>
          </div>

          {/* ── 인원별 비교표 ── */}
          <div className="vm-content">
            <div className="vm-table-wrap">
              <table className="vm-table vm-forecast-table">
                <thead>
                  <tr>
                    <th className="vm-col-num">인원</th>
                    <th className="vm-col-num">하루 처리 라인</th>
                    <th className="vm-col-num">하루 여유</th>
                    <th className="vm-col-num">따라잡기까지</th>
                    <th className="vm-col-week">따라잡는 날</th>
                    <th className="vm-col-num">지금 인원 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((r) => {
                    const diff =
                      sim?.workDays != null && r.result.workDays != null ? r.result.workDays - sim.workDays : null;
                    return (
                      <tr key={r.people} className={r.isCurrent ? 'vm-row-current' : ''}>
                        <td className="vm-col-num">{r.people}명{r.isCurrent && ' (지금)'}</td>
                        <td className="vm-col-num">{nf(r.result.dailyCapacity)}</td>
                        {(() => {
                          const margin = r.result.dailyCapacity - r.result.avgInflowLinesPerWorkDay;
                          return (
                            <td className={`vm-col-num ${margin < 0 ? 'vm-neg' : 'vm-pos'}`}>
                              {margin >= 0 ? '+' : ''}{nf(margin)}
                            </td>
                          );
                        })()}
                        <td className={`vm-col-num vm-strong ${r.result.workDays == null ? 'vm-neg' : ''}`}>
                          {r.result.workDays != null ? `${r.result.workDays}일` : '못 따라잡음'}
                        </td>
                        <td className="vm-col-week">{r.result.finishDate ? dayLabel(r.result.finishDate) : '—'}</td>
                        <td className={`vm-col-num ${diff == null || diff === 0 ? 'vm-muted' : diff < 0 ? 'vm-pos' : 'vm-neg'}`}>
                          {diff == null
                            ? r.isCurrent || (sim?.workDays == null && r.result.workDays == null) ? '—' : sim?.workDays == null ? '따라잡음' : '못 따라잡음'
                            : diff === 0 ? '같음' : diff < 0 ? `${-diff}일 빠름` : `${diff}일 느림`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ============================================================
              C. 유입 예측
              ============================================================ */}
          <div className="vm-section">
            <h2 className="vm-section-title">
              앞으로 {INFLOW_HORIZON_DAYS}일 예상 입고{' '}
              <span className="vm-section-sub">
                최근 8주 소요일 분포 (주문→입고 {nf(inflow.samples.ordered)}건 · 발송→입고 {nf(inflow.samples.shipped)}건 · 배송완료→입고 {nf(inflow.samples.delivered)}건)
              </span>
            </h2>
          </div>
          <div className="vm-content">
            <div className="vm-table-wrap">
              <table className="vm-table vm-forecast-table">
                <thead>
                  <tr>
                    <th className="vm-col-week">일자</th>
                    <th className="vm-col-num">예상 입고 행</th>
                    <th className="vm-col-num">예상 입고 수량</th>
                    <th className="vm-col-num">누적 수량</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let cum = 0;
                    return inflow.days.map((d) => {
                      cum += d.qty;
                      const sunday = dayOfWeek(d.date) === 0;
                      return (
                        <tr key={d.date} className={sunday ? 'vm-row-off' : ''}>
                          <td className="vm-col-week">{dayLabel(d.date)}{sunday && ' 휴무'}</td>
                          <td className="vm-col-num">{nf(d.rows)}</td>
                          <td className="vm-col-num vm-strong">{nf(d.qty)}</td>
                          <td className="vm-col-num vm-muted">{nf(cum)}</td>
                        </tr>
                      );
                    });
                  })()}
                  <tr>
                    <td className="vm-col-week vm-muted">{INFLOW_HORIZON_DAYS}일 뒤 또는 지연</td>
                    <td className="vm-col-num vm-muted">{nf(inflow.delayed.items)}</td>
                    <td className="vm-col-num vm-muted">{nf(inflow.delayed.qty)}</td>
                    <td className="vm-col-num vm-muted">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ============================================================
              D. 확인 필요
              ============================================================ */}
          <div className="vm-section">
            <h2 className="vm-section-title">
              확인 필요 <span className="vm-section-sub">배송완료 추정 후 7일 넘게 입고 스캔이 한 건도 없는 항목 — 분실·미스캔·업로드 오류 가능</span>
            </h2>
          </div>
          <div className="vm-content">
            {data.check_needed.length === 0 ? (
              <div className="vm-state">해당 항목이 없습니다.</div>
            ) : (
              <div className="vm-table-wrap">
                <table className="vm-table vm-forecast-table">
                  <thead>
                    <tr>
                      <th className="vm-col-text">사업자</th>
                      <th className="vm-col-text">주문번호</th>
                      <th className="vm-col-text">품번</th>
                      <th className="vm-col-text">상품</th>
                      <th className="vm-col-num">남은 수량</th>
                      <th className="vm-col-week">배송완료 추정</th>
                      <th className="vm-col-num">경과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.check_needed.map((r, i) => (
                      <tr key={`${r.item_no ?? ''}-${i}`}>
                        <td className="vm-col-text">{r.vender_name ?? '—'}</td>
                        <td className="vm-col-text">{r.order_no ?? '—'}</td>
                        <td className="vm-col-text">{r.item_no ?? '—'}</td>
                        <td className="vm-col-text">
                          {r.item_name ?? '—'}
                          {r.option_name && <span className="vm-muted"> · {r.option_name}</span>}
                        </td>
                        <td className="vm-col-num vm-strong">{nf(r.left_qty)}</td>
                        <td className="vm-col-week">{dayLabel(r.delivered_at.slice(0, 10))}</td>
                        <td className="vm-col-num vm-neg">{daysSince(r.delivered_at, data.meta.today)}일</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 안내 ── */}
          <p className="vm-footer-note">
            <b>미발송·배송중·배송완료</b>는 배송상황 CSV 이력으로 판정하고, 수량은 주문 − 입고 − 취소반품입니다.{' '}
            <b>포장 대기</b> = 입고 스캔 − 포장 스캔, <b>출고 대기</b> = 포장 스캔 − 쉽먼트 등록.{' '}
            <b>라인</b> = 입고 스캔 1행 + 포장 스캔 1행 (수량이 아니라 행 수 — 스캔 노동은 행 수에 비례).{' '}
            <b>따라잡기 예측</b>은 오늘부터 하루씩, 그날 예상 입고 행 × 2(입고 스캔 + 포장)를 대기열에 더하고 근무일(월~토)마다
            인원 × 인당 시간 × 처리속도 만큼 빼서, 처리 후 대기열이 0이 되는 첫 근무일(그날 들어온 것까지 다 처리한 날)을
            찾습니다. <b>하루 여유</b> = 하루 처리 라인 − 하루 유입 라인(앞으로 {INFLOW_HORIZON_DAYS}일 근무일 평균) — 음수면 밀림이
            늘어나므로 인원이 더 필요합니다. 출고(쉽먼트)는 출고일에 몰리므로 라인에 넣지 않습니다. 유입 예측은 미입고 항목마다 "이미 n일 지났는데 아직 안 왔다"는 조건으로 날짜별 도착 확률을
            곱한 기대값이며, 분포 밖이거나 {INFLOW_HORIZON_DAYS}일 안에 안 올 몫은 "지연"으로 따로 셉니다(시뮬레이션에는
            넣지 않음). <b>이미 1688에 주문한 물량만</b> 포함되므로, 앞으로 새로 주문할 분량은 여기 없습니다 — 1688 주문은
            며칠에 한 번 몰아서 하므로 큰 주문 직후에 보는 것이 가장 정확합니다.
            {data.snapshot.inconsistent > 0 && (
              <span className="vm-warn"> · 입고 스캔 없이 포장된 항목 {nf(data.snapshot.inconsistent)}건은 포장 대기 0으로 봤습니다.</span>
            )}
          </p>
        </>
      )}
    </>
  );
};

export default ForecastTab;
