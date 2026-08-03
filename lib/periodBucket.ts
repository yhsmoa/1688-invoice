// ============================================================
// 기간(주간/월간) 집계 공통 헬퍼
//
//   DB 관리 통계 API (/api/db/volume-weekly, /api/db/order-weekly) 가
//   공유한다. 날짜 연산은 모두 UTC 기준으로 수행해 서버 TZ 영향을 제거하고,
//   timestamptz → 날짜 변환만 KST(+9) 오프셋을 적용한다.
// ============================================================

export type Period = 'week' | 'month';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 쿼리스트링 값 → Period (기본 week) */
export function parsePeriod(value: string | null): Period {
  return value === 'month' ? 'month' : 'week';
}

/** timestamptz(ISO) → KST 기준 YYYY-MM-DD */
export function toKstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' + days → 'YYYY-MM-DD' */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 해당 날짜가 속한 주의 시작일(월요일) */
function weekStartOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();               // 0=일 … 6=토
  const diff = dow === 0 ? -6 : 1 - dow;    // 월요일로 이동
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

/**
 * 집계 구간의 시작일.
 *   week  → 그 주 월요일
 *   month → 그 달 1일
 * 월 경계를 걸친 주가 두 달에 중복 집계되지 않도록, 월간은 반드시
 * 주간 합산이 아니라 원본 날짜로부터 직접 버킷팅해야 한다.
 */
export function periodStartOf(dateStr: string, period: Period): string {
  return period === 'month' ? `${dateStr.slice(0, 7)}-01` : weekStartOf(dateStr);
}

/** 집계 구간의 종료일 (week: +6일, month: 그 달 말일) */
export function periodEndOf(startStr: string, period: Period): string {
  if (period === 'week') return addDays(startStr, 6);
  const [y, m] = startStr.split('-').map(Number);
  // Date.UTC(y, m, 0) → m월의 말일 (m 은 1-based 이므로 다음 달 0일)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
