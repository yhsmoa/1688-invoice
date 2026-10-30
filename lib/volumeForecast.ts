// ============================================================
// 물량예측 — 타입 · 예측 계산 (순수 함수)
//   원자료 : rpc db_volume_pipeline (supabase/db/002_volume_pipeline.sql)
//   API    : app/api/db/volume-forecast/route.ts  (원자료 그대로 전달)
//   화면   : app/db/volume/components/ForecastTab.tsx (여기 함수로 계산)
//
//   계산을 화면에서 하는 이유: 인원·근무시간·처리속도 입력값을 바꿀 때마다
//   재조회하지 않고 즉시 다시 계산하기 위해 (원자료는 입력값과 무관).
// ============================================================

// ── 파이프라인 칸 ──
export const PIPELINE_STAGES = [
  'unshipped',
  'in_transit',
  'delivered_waiting',
  'no_history',
  'arrived_waiting',
  'packed_waiting',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<PipelineStage, string> = {
  unshipped: '미발송',
  in_transit: '배송중',
  delivered_waiting: '배송완료 · 입고 대기',
  no_history: '배송이력 없음',
  arrived_waiting: '입고 완료 · 포장 대기',
  packed_waiting: '포장 완료 · 출고 대기',
};

/** 아직 창고에 안 들어온 칸 (= 앞으로 들어올 물량) */
export const INCOMING_STAGES: readonly PipelineStage[] = ['unshipped', 'in_transit', 'delivered_waiting', 'no_history'];

export interface StageCount {
  items: number;
  qty: number;
}

export interface PendingRow {
  stage: PipelineStage;
  /** 기준일로부터 지난 일수 */
  days: number;
  items: number;
  qty: number;
}

export interface HistRow {
  days: number;
  n: number;
}

export type LeadKey = 'ordered' | 'shipped' | 'delivered';

export interface CapacityDay {
  date: string;
  arr_rows: number;
  arr_qty: number;
  pack_rows: number;
  pack_qty: number;
  minutes_all: number;
  minutes_pi: number;
  ppl_all: number;
  ppl_pi: number;
}

export interface CheckNeededRow {
  order_no: string | null;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  left_qty: number;
  delivered_at: string;
  vender_name: string | null;
  ono: string | null;
}

export interface PipelineData {
  snapshot: {
    stages: Record<PipelineStage, StageCount>;
    wait_hist: { days: number; items: number; qty: number }[];
    inconsistent: number;
  };
  pending: PendingRow[];
  lead_hist: Record<LeadKey, HistRow[]>;
  capacity_days: CapacityDay[];
  check_needed: CheckNeededRow[];
  meta: { last_upload_at: string | null; today: string };
}

export interface VolumeForecastResponse {
  success: boolean;
  error?: string;
  data?: PipelineData;
}

// ── 근무시간 분모 (물량처리 탭과 같은 개념) ──
export type CapacityDenom = 'all' | 'pi';
export const DENOM_LABEL: Record<CapacityDenom, string> = { all: '전체', pi: '포장+검수' };

// ============================================================
// 날짜 helper (KST 날짜 문자열 'YYYY-MM-DD' 기준, UTC 연산으로 TZ 영향 제거)
// ============================================================
export const addDays = (dateStr: string, days: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

/** 0=일 … 6=토 */
export const dayOfWeek = (dateStr: string): number => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** 창고는 월~토 근무, 일요일 휴무 (근무기록 기준) */
export const isWorkDay = (dateStr: string): boolean => dayOfWeek(dateStr) !== 0;

// ============================================================
// 대기 일수 묶음 (포장 대기 칸)
// ============================================================
export const WAIT_BUCKETS = [
  { key: '0', label: '0일', min: 0, max: 0 },
  { key: '1-2', label: '1~2일', min: 1, max: 2 },
  { key: '3-6', label: '3~6일', min: 3, max: 6 },
  { key: '7-13', label: '7~13일', min: 7, max: 13 },
  { key: '14+', label: '14일+', min: 14, max: Infinity },
] as const;

export interface WaitBucket {
  key: string;
  label: string;
  items: number;
  qty: number;
}

export const bucketWaitHist = (hist: PipelineData['snapshot']['wait_hist']): WaitBucket[] =>
  WAIT_BUCKETS.map((b) => {
    let items = 0;
    let qty = 0;
    for (const h of hist) {
      if (h.days >= b.min && h.days <= b.max) {
        items += h.items;
        qty += h.qty;
      }
    }
    return { key: b.key, label: b.label, items, qty };
  });

// ============================================================
// 유입 예측 — 앞으로 들어올 물량이 언제 입고되나
//
//   미입고 묶음(칸, 지난 일수 a, 항목·수량)마다 그 칸의 소요일 분포 hist 로
//     P(d일째 입고 | 이미 a일 지남) = hist[d] / Σ_{k ≥ a} hist[k]     (d ≥ a)
//   를 구해 오늘(offset 0)부터 horizon 일까지 날짜별 기대값을 더한다.
//   분포의 꼬리(Σ_{k ≥ a}) 가 0 이면 분포 밖 → '지연' 으로 따로 센다.
//   horizon 을 넘는 확률 질량도 '지연' 에 더한다 (화면에는 "14일 안에 안 올 것으로 예상").
// ============================================================
const STAGE_LEAD: Record<PipelineStage, LeadKey | null> = {
  unshipped: 'ordered',
  in_transit: 'shipped',
  delivered_waiting: 'delivered',
  no_history: 'ordered',
  arrived_waiting: null,
  packed_waiting: null,
};

/** 분포 표본이 이보다 적으면 주문→입고 전체 분포로 대체 */
const MIN_HIST_SAMPLES = 200;

export interface InflowDay {
  date: string;
  /** 기대 입고 행(항목) 수 */
  rows: number;
  /** 기대 입고 수량 */
  qty: number;
}

export interface InflowForecast {
  days: InflowDay[];
  /** 분포 밖이거나 horizon 안에 안 올 것으로 예상되는 몫 */
  delayed: StageCount;
  /** 분포에 쓰인 표본 수 */
  samples: Record<LeadKey, number>;
}

const toDense = (rows: HistRow[]): number[] => {
  const max = rows.reduce((m, r) => Math.max(m, r.days), 0);
  const out = new Array<number>(max + 1).fill(0);
  for (const r of rows) out[r.days] += r.n;
  return out;
};

export function computeInflow(data: PipelineData, horizonDays = 14): InflowForecast {
  const samples = {
    ordered: data.lead_hist.ordered.reduce((n, r) => n + r.n, 0),
    shipped: data.lead_hist.shipped.reduce((n, r) => n + r.n, 0),
    delivered: data.lead_hist.delivered.reduce((n, r) => n + r.n, 0),
  };
  const dense: Record<LeadKey, number[]> = {
    ordered: toDense(data.lead_hist.ordered),
    shipped: toDense(data.lead_hist.shipped),
    delivered: toDense(data.lead_hist.delivered),
  };
  const histFor = (key: LeadKey): number[] =>
    samples[key] >= MIN_HIST_SAMPLES ? dense[key] : dense.ordered;

  const days: InflowDay[] = Array.from({ length: horizonDays }, (_, i) => ({
    date: addDays(data.meta.today, i),
    rows: 0,
    qty: 0,
  }));
  const delayed: StageCount = { items: 0, qty: 0 };

  for (const p of data.pending) {
    const key = STAGE_LEAD[p.stage];
    if (!key) continue;
    const hist = histFor(key);
    let tail = 0;
    for (let k = p.days; k < hist.length; k++) tail += hist[k];
    if (tail <= 0) {
      delayed.items += p.items;
      delayed.qty += p.qty;
      continue;
    }
    let placed = 0;
    for (let d = p.days; d < hist.length; d++) {
      const prob = hist[d] / tail;
      if (prob === 0) continue;
      const offset = d - p.days;
      if (offset >= horizonDays) break;
      days[offset].rows += p.items * prob;
      days[offset].qty += p.qty * prob;
      placed += prob;
    }
    delayed.items += p.items * (1 - placed);
    delayed.qty += p.qty * (1 - placed);
  }

  return { days, delayed, samples };
}

// ============================================================
// 처리 능력 — 최근 28일 실측
//   근무일 = 근무기록이 있고 스캔(입고행+포장행)이 1건 이상인 날
//   라인/인시 = 근무일별 (입고행 + 포장행) ÷ 선택한 직책 근무시간 의 중앙값
// ============================================================
export interface Capacity {
  workDays: number;
  avgPeople: number;
  hoursPerPersonDay: number;
  linesPerPersonHour: number;
  avgLinesPerDay: number;
  avgArrRowsPerDay: number;
  avgPackRowsPerDay: number;
  avgArrQtyPerDay: number;
  avgPackQtyPerDay: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function computeCapacity(days: CapacityDay[], denom: CapacityDenom): Capacity {
  const minutesOf = (d: CapacityDay) => (denom === 'all' ? d.minutes_all : d.minutes_pi);
  const peopleOf = (d: CapacityDay) => (denom === 'all' ? d.ppl_all : d.ppl_pi);
  const work = days.filter((d) => minutesOf(d) > 0 && peopleOf(d) > 0 && d.arr_rows + d.pack_rows > 0);
  if (work.length === 0) {
    return {
      workDays: 0, avgPeople: 0, hoursPerPersonDay: 0, linesPerPersonHour: 0,
      avgLinesPerDay: 0, avgArrRowsPerDay: 0, avgPackRowsPerDay: 0, avgArrQtyPerDay: 0, avgPackQtyPerDay: 0,
    };
  }
  const sum = (f: (d: CapacityDay) => number) => work.reduce((n, d) => n + f(d), 0);
  const totalHours = sum(minutesOf) / 60;
  const totalPeopleDays = sum(peopleOf);
  return {
    workDays: work.length,
    avgPeople: totalPeopleDays / work.length,
    hoursPerPersonDay: totalHours / totalPeopleDays,
    linesPerPersonHour: median(work.map((d) => (d.arr_rows + d.pack_rows) / (minutesOf(d) / 60))),
    avgLinesPerDay: sum((d) => d.arr_rows + d.pack_rows) / work.length,
    avgArrRowsPerDay: sum((d) => d.arr_rows) / work.length,
    avgPackRowsPerDay: sum((d) => d.pack_rows) / work.length,
    avgArrQtyPerDay: sum((d) => d.arr_qty) / work.length,
    avgPackQtyPerDay: sum((d) => d.pack_qty) / work.length,
  };
}

// ============================================================
// 따라잡기 시뮬레이션 — "이 인원·속도면 밀린 물량을 며칠 만에 따라잡나"
//
//   오늘부터 하루씩: 그날 예상 입고 행 × 2 (입고 스캔 1 + 포장 1) 를 대기열에 더하고,
//   근무일(월~토)이면 하루 처리 라인(인원 × 인당 시간 × 라인/인시)만큼 뺀다.
//   처리 후 대기열이 0 이 되는 첫 근무일 = 따라잡은 날 (그날 들어온 것까지 다 처리).
//   (오늘도 근무일이면 1일로 센다)
//   유입 예측 기간(horizon) 밖은 유입을 모르므로 그 안에 못 따라잡으면 null —
//   하루 처리가 하루 유입보다 적어 밀림이 늘어나는 상태다.
//   유입 '지연' 분은 언제 올지 모르므로 시뮬레이션에 넣지 않는다 (화면에 따로 표시).
// ============================================================
export interface SimInput {
  today: string;
  /** 포장 대기 행 수 (각 1 라인) */
  backlogPackRows: number;
  /** 날짜별 예상 입고 행 (오늘 = index 0) */
  inflowRows: number[];
  people: number;
  hoursPerPersonDay: number;
  linesPerPersonHour: number;
}

export interface SimResult {
  /** 하루 처리 라인 */
  dailyCapacity: number;
  /** 예측 기간의 근무일당 평균 유입 라인 (입고 행 × 2) */
  avgInflowLinesPerWorkDay: number;
  /** 처리해야 할 라인 총합 (대기 + 기간 내 유입×2) */
  totalLines: number;
  /** 따라잡기까지 근무일 (null = 예측 기간 안에 못 따라잡음) */
  workDays: number | null;
  /** 따라잡는 날 */
  finishDate: string | null;
  /** 예측 기간 일수 (inflowRows.length) */
  horizonDays: number;
}

export function simulateClear(input: SimInput): SimResult {
  const dailyCapacity = input.people * input.hoursPerPersonDay * input.linesPerPersonHour;
  const horizonDays = input.inflowRows.length;
  const inflowTotal = input.inflowRows.reduce((n, r) => n + r, 0);
  const totalLines = input.backlogPackRows + inflowTotal * 2;
  const horizonWorkDays = Array.from({ length: horizonDays }, (_, i) => addDays(input.today, i)).filter(isWorkDay).length;
  const avgInflowLinesPerWorkDay = horizonWorkDays > 0 ? (inflowTotal * 2) / horizonWorkDays : 0;
  const base = { dailyCapacity, avgInflowLinesPerWorkDay, totalLines, horizonDays };

  if (totalLines <= 0) return { ...base, workDays: 0, finishDate: input.today };
  if (dailyCapacity <= 0) return { ...base, workDays: null, finishDate: null };

  let queue = input.backlogPackRows;
  let workDays = 0;
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(input.today, i);
    queue += input.inflowRows[i] * 2;
    if (!isWorkDay(date)) continue;
    workDays += 1;
    queue -= dailyCapacity;
    if (queue <= 0) return { ...base, workDays, finishDate: date };
  }
  return { ...base, workDays: null, finishDate: null };
}

/** 인원을 바꿔 가며 소진일을 비교 — base ± 범위 */
export interface HeadcountRow {
  people: number;
  isCurrent: boolean;
  result: SimResult;
}

export function headcountTable(
  base: Omit<SimInput, 'people'>,
  currentPeople: number,
  below = 3,
  above = 4
): HeadcountRow[] {
  const rows: HeadcountRow[] = [];
  for (let p = Math.max(1, currentPeople - below); p <= currentPeople + above; p++) {
    rows.push({ people: p, isCurrent: p === currentPeople, result: simulateClear({ ...base, people: p }) });
  }
  return rows;
}
