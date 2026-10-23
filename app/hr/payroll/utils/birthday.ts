// ============================================================
// 생일 주간 판정 — 급여장부 직원 헤더 👑 표시용
//
//   · "오늘(KST)이 속한 주(월~일)" 안에 생일(월/일)이 있으면 생일 주간
//   · 보고 있는 달과 무관하게 실제 오늘 기준 (그 주 동안 계속 표시)
//   · 2월 29일 생일은 윤년이 아닌 해에 2월 28일로 본다
//   · 날짜 계산은 UTC 자정 기준 Date 로만 해서 브라우저 시간대 영향을 받지 않는다
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface BirthdayInWeek {
  month: number;   // 1~12
  day: number;     // 1~31
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** 오늘(KST) 날짜를 UTC 자정 Date 로 */
export function todayKSTDate(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

/** 'YYYY-MM-DD' → { month, day } (형식이 틀리면 null) */
function parseMonthDay(birthDate: string | null | undefined): BirthdayInWeek | null {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

/**
 * 오늘이 속한 주(월요일 시작) 안에 생일이 있으면 그 날짜(월/일), 없으면 null
 */
export function birthdayInThisWeek(
  birthDate: string | null | undefined,
  today: Date = todayKSTDate(),
): BirthdayInWeek | null {
  const birth = parseMonthDay(birthDate);
  if (!birth) return null;

  const mondayOffset = (today.getUTCDay() + 6) % 7;            // 월=0 … 일=6
  const monday = today.getTime() - mondayOffset * DAY_MS;

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday + i * DAY_MS);
    const y = d.getUTCFullYear();
    // 2/29 생일 → 평년에는 2/28
    const targetDay = birth.month === 2 && birth.day === 29 && !isLeapYear(y) ? 28 : birth.day;
    if (d.getUTCMonth() + 1 === birth.month && d.getUTCDate() === targetDay) {
      return { month: birth.month, day: targetDay };
    }
  }
  return null;
}
