// ============================================================
// 물량관리 — 기간(일/주/월) 표시 helper (물량처리 / 처리속도 탭 공용)
// ============================================================
import { PERIOD_UNITS, type PeriodUnit } from '../../../../lib/periodBucket';

export { PERIOD_UNITS, type PeriodUnit };

export const PERIOD_LABEL: Record<PeriodUnit, string> = {
  day: '일간',
  week: '주간',
  month: '월간',
};

/** 표 첫 열 제목 */
export const PERIOD_COLUMN_LABEL: Record<PeriodUnit, string> = {
  day: '일자',
  week: '주차',
  month: '월',
};

/** ISO 일시 → 'MM.DD HH:mm' (KST) — 업로드 시각 등 표시용 */
export const formatKstDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** '2026-07-27' → '07.27' */
export const shortDate = (d: string) => d.slice(5).replace('-', '.');

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 일간 라벨 — '2026-10-29' → '10.29 (목)' */
export const dayLabel = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return `${shortDate(date)} (${WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
};

/** 구간 라벨 — 일간: '10.29 (목)' / 주간: '{월}월 {n}주차'(그 달 첫 월요일 기준) / 월간: '{연}년 {월}월' */
export const periodLabel = (periodStart: string, period: PeriodUnit): string => {
  if (period === 'day') return dayLabel(periodStart);
  const [y, m, d] = periodStart.split('-').map(Number);
  if (period === 'month') return `${y}년 ${m}월`;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = first.getUTCDay();
  const offsetToMonday = firstDow === 0 ? 1 : firstDow === 1 ? 0 : 8 - firstDow;
  const firstMonday = 1 + offsetToMonday;
  const nth = Math.floor((d - firstMonday) / 7) + 1;
  return nth >= 1 ? `${m}월 ${nth}주차` : `${m}월 1주차`;
};
