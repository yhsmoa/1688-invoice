// ============================================================
// 처리속도 통계 — 공용 타입·상수·집계 helper
//   API  : app/api/db/process-speed/route.ts
//   화면 : app/db/volume/components/ProcessSpeedTab.tsx
// ============================================================

// ── 단계 ──
export const STAGES = ['delivery', 'arrival', 'packing', 'outbound'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  delivery: '배송',
  arrival: '입고',
  packing: '포장',
  outbound: '출고',
};

// ── 구분: 전체 / 세트 / 단품 ──
export const SET_KINDS = ['ALL', 'SET', 'SINGLE'] as const;
export type SetKind = (typeof SET_KINDS)[number];

export const SET_KIND_LABEL: Record<SetKind, string> = {
  ALL: '전체',
  SET: '세트',
  SINGLE: '단품',
};

// ── 사이즈: 전체 / A·B·C(쿠팡) / P(개인) / X(직배송) ──
export const SIZE_KEYS = ['ALL', 'A', 'B', 'C', 'P', 'X'] as const;
export type SizeKey = (typeof SIZE_KEYS)[number];

// ── 셀 통계 — 평균은 표시 시점에 sumDays / n (합산 가능한 형태로 보관) ──
export interface StageStat {
  sumDays: number;
  n: number;
  /** 배송완료 하한이 없는(상한만 있는) 추정 표본 수 — 배송·입고 단계만 해당 */
  nUpperOnly: number;
  /** 시각 역전 등 데이터 오류로 제외된 수 */
  nSkipped: number;
}

export type StageStats = Record<Stage, StageStat>;
export type SpeedCells = Record<SetKind, Record<SizeKey, StageStats>>;

export interface SpeedPeriod {
  periodStart: string;
  periodEnd: string;
  cells: SpeedCells;
}

export interface ProcessSpeedResponse {
  success: boolean;
  error?: string;
  period: 'week' | 'month';
  basis: 'shipment' | 'confirmed';
  periods: SpeedPeriod[];
  meta: {
    /** 마지막 배송상황 CSV 업로드 시각 (im_1688_delivery_history.last_seen_at 최대) */
    lastDeliveryUploadAt: string | null;
  };
}

// ============================================================
// helper
// ============================================================
export const emptyStat = (): StageStat => ({ sumDays: 0, n: 0, nUpperOnly: 0, nSkipped: 0 });

export const emptyStageStats = (): StageStats => ({
  delivery: emptyStat(),
  arrival: emptyStat(),
  packing: emptyStat(),
  outbound: emptyStat(),
});

export const emptyCells = (): SpeedCells => {
  const out = {} as SpeedCells;
  for (const k of SET_KINDS) {
    out[k] = {} as Record<SizeKey, StageStats>;
    for (const s of SIZE_KEYS) out[k][s] = emptyStageStats();
  }
  return out;
};

/** target 에 src 를 더한다 (가중 평균을 위해 합계·표본수를 그대로 합산) */
export const addStat = (target: StageStat, src: StageStat): void => {
  target.sumDays += src.sumDays;
  target.n += src.n;
  target.nUpperOnly += src.nUpperOnly;
  target.nSkipped += src.nSkipped;
};

/** 평균 소요일 (소수 1자리) — 표본 0 이면 null */
export const avgDays = (s: StageStat): number | null =>
  s.n > 0 ? Math.round((s.sumDays / s.n) * 10) / 10 : null;
