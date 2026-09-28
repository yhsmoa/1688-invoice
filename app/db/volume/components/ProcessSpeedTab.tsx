'use client';

import React, { useMemo, useState } from 'react';
import {
  SET_KINDS,
  SET_KIND_LABEL,
  SIZE_KEYS,
  STAGES,
  STAGE_LABEL,
  addStat,
  avgDays,
  emptyStageStats,
  type SetKind,
  type SizeKey,
  type Stage,
  type StageStat,
  type StageStats,
} from '../../../../lib/processSpeed';
import { useProcessSpeed, type SpeedBasis } from '../hooks/useProcessSpeed';
import { PERIOD_LABEL, periodLabel, shortDate, type Period } from '../utils/periodLabel';

// ============================================================
// [처리속도] 탭 — 단계별 평균 소요일 (주간/월간)
//
//   배송  1688 주문일시 → 배송완료(추정)        항목(부품) 단위
//   입고  배송완료(추정) → 첫 입고 스캔          항목(부품) 단위
//   포장  포장 직전 마지막 입고 → 포장 스캔      포장 행 단위 (세트는 부품이 다 온 시각부터)
//   출고  포장 스캔 → 출고 처리(또는 확정)       포장 행 단위
//
//   데이터: GET /api/db/process-speed (rpc db_process_speed)
//   구분(전체/세트/단품) · 사이즈(전체/A/B/C/P/X)는 응답의 셀을 고르기만 한다.
// ============================================================

const nf = (n: number) => n.toLocaleString('ko-KR');

const BASIS_LABEL: Record<SpeedBasis, string> = {
  shipment: '출고일',
  confirmed: '확정일',
};

const SIZE_LABEL: Record<SizeKey, string> = {
  ALL: '전체',
  A: 'A',
  B: 'B',
  C: 'C',
  P: 'P',
  X: 'X',
};

/** 배송·입고 단계 — 배송상황 CSV 이력이 필요한 단계 */
const DELIVERY_STAGES = new Set<Stage>(['delivery', 'arrival']);

/** 마지막 배송상황 업로드가 이 일수보다 오래되면 경고 (운영 규칙: 하루 1회 업로드) */
const DELIVERY_UPLOAD_STALE_DAYS = 2;
const DAY_MS = 86_400_000;

/** ISO → 'MM.DD HH:mm' (KST) */
const formatKst = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** 네 단계 평균이 모두 있을 때만 합계 (주문 → 출고) */
const totalOfStages = (stats: StageStats): number | null => {
  let sum = 0;
  for (const s of STAGES) {
    const avg = avgDays(stats[s]);
    if (avg === null) return null;
    sum += avg;
  }
  return Math.round(sum * 10) / 10;
};

// ============================================================
// 셀 — 평균 + 표본수 (+ 추정 표본)
// ============================================================
const StageCell: React.FC<{ stat: StageStat; stage: Stage }> = ({ stat, stage }) => {
  const avg = avgDays(stat);
  if (avg === null) return <span className="vm-none">—</span>;
  const showEstimate = DELIVERY_STAGES.has(stage) && stat.nUpperOnly > 0;
  return (
    <div className="vm-speed-cell">
      <span className="vm-speed-value">{avg}일</span>
      <span className="vm-speed-n">
        n={nf(stat.n)}
        {showEstimate && <span className="vm-speed-est"> · 추정 {nf(stat.nUpperOnly)}</span>}
      </span>
    </div>
  );
};

interface ProcessSpeedTabProps {
  /** 탭 선택 버튼 — 컨트롤 줄 왼쪽에 배치 (VolumeManage 가 전달) */
  tabSwitcher: React.ReactNode;
}

const ProcessSpeedTab: React.FC<ProcessSpeedTabProps> = ({ tabSwitcher }) => {
  const [period, setPeriod] = useState<Period>('week');
  const [basis, setBasis] = useState<SpeedBasis>('shipment');
  const [setKind, setSetKind] = useState<SetKind>('ALL');
  const [size, setSize] = useState<SizeKey>('ALL');

  const { periods, lastDeliveryUploadAt, loading, error } = useProcessSpeed(period, basis);

  // ── 선택한 (구분 × 사이즈) 셀만 추리기 ──
  const rows = useMemo(
    () => periods.map((p) => ({ ...p, stats: p.cells[setKind][size] })),
    [periods, setKind, size]
  );

  // ── 전체 기간 합산 (가중 평균) ──
  const totals = useMemo(() => {
    const acc = emptyStageStats();
    for (const r of rows) for (const s of STAGES) addStat(acc[s], r.stats[s]);
    return acc;
  }, [rows]);

  const skippedTotal = STAGES.reduce((n, s) => n + totals[s].nSkipped, 0);

  const uploadStale =
    !lastDeliveryUploadAt ||
    Date.now() - new Date(lastDeliveryUploadAt).getTime() > DELIVERY_UPLOAD_STALE_DAYS * DAY_MS;

  return (
    <>
      {/* ── 컨트롤 줄: 왼쪽 탭 선택 / 오른쪽 컨트롤 ── */}
      <div className="vm-toolbar">
        {tabSwitcher}
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
            <span className="vm-basis-label">출고 기준</span>
            {(Object.keys(BASIS_LABEL) as SpeedBasis[]).map((b) => (
              <button
                key={b}
                className={`vm-basis-btn ${basis === b ? 'active' : ''}`}
                onClick={() => setBasis(b)}
              >
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
          <div className="vm-basis">
            <span className="vm-basis-label">구분</span>
            {SET_KINDS.map((k) => (
              <button
                key={k}
                className={`vm-basis-btn ${setKind === k ? 'active' : ''}`}
                onClick={() => setSetKind(k)}
              >
                {SET_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="vm-basis">
            <span className="vm-basis-label">사이즈</span>
            {SIZE_KEYS.map((s) => (
              <button
                key={s}
                className={`vm-basis-btn ${size === s ? 'active' : ''}`}
                onClick={() => setSize(s)}
              >
                {SIZE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 배송상황 업로드 상태 (배송·입고 단계의 정확도 근거) ── */}
      {!loading && !error && (
        <div className={`vm-speed-upload ${uploadStale ? 'vm-speed-upload--stale' : ''}`}>
          마지막 배송상황 업로드:{' '}
          <b>{lastDeliveryUploadAt ? formatKst(lastDeliveryUploadAt) : '기록 없음'}</b>
          {uploadStale && ` — ${DELIVERY_UPLOAD_STALE_DAYS}일 넘게 업로드되지 않아 배송·입고 시각 오차가 커집니다.`}
        </div>
      )}

      {/* ── 요약 카드: 단계별 전체 기간 평균 ── */}
      {!loading && !error && rows.length > 0 && (
        <div className="vm-summary">
          {STAGES.map((s) => {
            const avg = avgDays(totals[s]);
            return (
              <div key={s} className="vm-sum-card">
                <span className="vm-sum-label">{STAGE_LABEL[s]} 평균</span>
                <span className="vm-sum-value">{avg ?? '—'}</span>
                <span className="vm-sum-unit">
                  일 · n={nf(totals[s].n)}
                  {DELIVERY_STAGES.has(s) && totals[s].nUpperOnly > 0 && ` · 추정 ${nf(totals[s].nUpperOnly)}`}
                </span>
              </div>
            );
          })}
          <div className="vm-sum-card vm-sum-card-accent">
            <span className="vm-sum-label">합계 (주문 → 출고)</span>
            <span className="vm-sum-value">{totalOfStages(totals) ?? '—'}</span>
            <span className="vm-sum-unit">일 · 단계 평균의 합</span>
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
            <table className="vm-table vm-speed-table">
              <thead>
                <tr>
                  <th className="vm-col-week">{period === 'month' ? '월' : '주차'}</th>
                  <th className="vm-col-range">기간</th>
                  {STAGES.map((s) => (
                    <th key={s} className="vm-col-speed">{STAGE_LABEL[s]}</th>
                  ))}
                  <th className="vm-col-speed">합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const total = totalOfStages(r.stats);
                  return (
                    <tr key={r.periodStart}>
                      <td className="vm-col-week">{periodLabel(r.periodStart, period)}</td>
                      <td className="vm-col-range">
                        {shortDate(r.periodStart)} ~ {shortDate(r.periodEnd)}
                      </td>
                      {STAGES.map((s) => (
                        <td key={s} className="vm-col-speed">
                          <StageCell stat={r.stats[s]} stage={s} />
                        </td>
                      ))}
                      <td className="vm-col-speed">
                        {total !== null ? (
                          <span className="vm-speed-value vm-accent">{total}일</span>
                        ) : (
                          <span className="vm-none">—</span>
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
      <p className="vm-footer-note">
        <b>배송</b> = 1688 주문일시 → 배송완료, <b>입고</b> = 배송완료 → 첫 입고 스캔,{' '}
        <b>포장</b> = 포장 직전 마지막 입고 → 포장 스캔, <b>출고</b> = 포장 스캔 → 출고 처리
        (기준 <b>확정일</b>이면 출고 확정 시각). 각 기간은 단계가 <b>끝난 날(KST)</b> 기준이며 주간은
        월요일 시작입니다. 배송완료 시각은 1688 에서 제공되지 않아 배송상황 CSV 업로드 시점으로
        추정합니다 — 직전 업로드와의 중간값이며, 이력 시작(2026-09-22) 전부터 배송완료였던 주문은
        처음 확인된 업로드 시각을 그대로 써서 <b>추정</b>으로 따로 표시합니다. 업로드 간격만큼
        오차가 생기므로 매일 업로드해 주세요. <b>세트</b>는 배송·입고를 부품(항목)마다, 포장·출고를
        세트 1건으로 세므로 단계별 n 이 다릅니다. 세트의 포장 시간은 부품이 모두 입고된 시각부터
        잽니다. <b>합계</b>는 네 단계 평균을 더한 값으로, 모든 단계에 표본이 있을 때만 표시합니다.
        {skippedTotal > 0 && (
          <span className="vm-warn"> · 시각이 뒤바뀐 데이터 {nf(skippedTotal)}건은 제외했습니다.</span>
        )}
      </p>
    </>
  );
};

export default ProcessSpeedTab;
