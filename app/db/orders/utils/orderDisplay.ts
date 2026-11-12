import type { OrderPeriod } from '../../../../lib/orderFlow';

// ============================================================
// 주문 데이터 관리 — 표시 helper (숫자·날짜·구간 라벨)
// ============================================================

// ── 숫자 ──
export const nf = (n: number) => n.toLocaleString('ko-KR');
export const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 비율(%) 소수 1자리 — 분모가 0 이면 null
 *   반올림 때문에 숫자와 어긋나 보이지 않게 양 끝을 지킨다:
 *   · 전부가 아니면 100 이 되지 않는다 (99.96% → 99.9%, 남은 수량이 있는데 100% 로 보이지 않게)
 *   · 0 이 아니면 0 이 되지 않는다   (0.04% → 0.1%)
 */
export const pctOf = (part: number, total: number): number | null => {
  if (total <= 0) return null;
  const pct = round1((part / total) * 100);
  if (pct >= 100 && part < total) return 99.9;
  if (pct <= 0 && part > 0) return 0.1;
  return pct;
};

// ── 집계 단위 ──
/** 버튼 순서 = 이 배열 순서 */
export const PERIODS: OrderPeriod[] = ['day', 'week', 'month'];

export const PERIOD_LABEL: Record<OrderPeriod, string> = {
  day: '일간',
  week: '주간',
  month: '월간',
};

/** 단위 한 글자 — '{일|주|월} 평균 주문량' */
export const PERIOD_UNIT: Record<OrderPeriod, string> = {
  day: '일',
  week: '주',
  month: '월',
};

export const PERIOD_SUBTITLE: Record<OrderPeriod, string> = {
  day: '일별 주문량',
  week: '주간별 주문량 (월~일)',
  month: '월별 주문량',
};

/** 오늘이 속한 구간을 부르는 말 — 잠재 주문량이 얹히는 행 */
export const PERIOD_CURRENT: Record<OrderPeriod, string> = {
  day: '오늘',
  week: '이번 주',
  month: '이번 달',
};

/** 표 첫 열 머리글 */
export const PERIOD_COLUMN: Record<OrderPeriod, string> = {
  day: '일자',
  week: '주차',
  month: '월',
};

// ── 날짜 ──
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → UTC Date (서버·브라우저 TZ 와 무관하게 달력 날짜만 다룬다) */
const utcDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** '2026-07-27' → '07.27' */
export const shortDate = (d: string) => d.slice(5).replace('-', '.');

/**
 * 구간 라벨
 *   일간: '{월}월 {일}일' / 주간: '{월}월 {n}주차'(그 달 첫 월요일 기준) / 월간: '{연}년 {월}월'
 */
export const periodLabel = (periodStart: string, period: OrderPeriod): string => {
  const [y, m, d] = periodStart.split('-').map(Number);
  if (period === 'month') return `${y}년 ${m}월`;
  if (period === 'day') return `${m}월 ${d}일`;
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offsetToMonday = firstDow === 0 ? 1 : firstDow === 1 ? 0 : 8 - firstDow;
  const firstMonday = 1 + offsetToMonday;
  const nth = Math.floor((d - firstMonday) / 7) + 1;
  return nth >= 1 ? `${m}월 ${nth}주차` : `${m}월 1주차`;
};

/** '기간' 열 — 일간: '2026.11.11 (수)' / 주간·월간: '11.09 ~ 11.15' */
export const periodRange = (start: string, end: string, period: OrderPeriod): string => {
  if (period === 'day') return `${start.replace(/-/g, '.')} (${WEEKDAYS[utcDate(start).getUTCDay()]})`;
  return `${shortDate(start)} ~ ${shortDate(end)}`;
};

/** timestamptz(ISO) → 'MM.DD HH:mm' (KST 고정 — 보는 사람의 PC 시간대와 무관) */
export const kstDateTime = (iso: string): string => {
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${kst.slice(5, 7)}.${kst.slice(8, 10)} ${kst.slice(11, 16)}`;
};
