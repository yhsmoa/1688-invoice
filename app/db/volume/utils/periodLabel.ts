// ============================================================
// 물량관리 — 기간(주/월) 표시 helper (물량처리 / 처리속도 탭 공용)
// ============================================================

export type Period = 'week' | 'month';

export const PERIOD_LABEL: Record<Period, string> = {
  week: '주간',
  month: '월간',
};

/** '2026-07-27' → '07.27' */
export const shortDate = (d: string) => d.slice(5).replace('-', '.');

/** 구간 라벨 — 주간: '{월}월 {n}주차'(그 달 첫 월요일 기준) / 월간: '{연}년 {월}월' */
export const periodLabel = (periodStart: string, period: Period): string => {
  const [y, m, d] = periodStart.split('-').map(Number);
  if (period === 'month') return `${y}년 ${m}월`;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstDow = first.getUTCDay();
  const offsetToMonday = firstDow === 0 ? 1 : firstDow === 1 ? 0 : 8 - firstDow;
  const firstMonday = 1 + offsetToMonday;
  const nth = Math.floor((d - firstMonday) / 7) + 1;
  return nth >= 1 ? `${m}월 ${nth}주차` : `${m}월 1주차`;
};
