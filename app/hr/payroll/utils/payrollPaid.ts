// ============================================================
// 급여 지급완료 — 화면용 타입 · 금액 계산 (순수 함수)
//
//   서버 규칙(lib/payrollCalc.calcSalary)과 같다:
//     급여 = floor(시급 × 근무 분 / 60)
//   지급완료 금액은 "지급 묶음 × 직원" 단위로 지급 시점 시급(스냅샷)으로 계산한다.
//   → [부분엑셀] 로 뽑은 금액(선택 시간 합 × 시급, 내림)과 같은 값이 된다.
// ============================================================

/** /api/hr/payroll 응답의 지급완료 항목 (lib/payrollPayments.PaidItem 과 동일) */
export interface PaidItem {
  record_id: string;
  payment_id: string;
  employee_id: string;
  work_date: string;
  minutes: number;
  hourly_wage: number | null;
  paid_date: string;
}

export interface PaidSum {
  minutes: number;
  amount: number;
}

/** 시급 × 근무 분 → 급여 (내림). 시급·분이 없으면 0 */
export const calcSalary = (hourlyWage: number | null | undefined, minutes: number): number =>
  hourlyWage && hourlyWage > 0 && minutes > 0 ? Math.floor((hourlyWage * minutes) / 60) : 0;

/** 직원별 지급완료 합계 — 지급 묶음별로 내림 계산 후 합산 */
export function paidByEmployee(items: PaidItem[]): Map<string, PaidSum> {
  // 묶음 × 직원 단위로 분을 모은다 (같은 묶음 안에서는 시급 스냅샷이 같다)
  const groups = new Map<string, { employeeId: string; wage: number | null; minutes: number }>();
  for (const it of items) {
    const key = `${it.payment_id}|${it.employee_id}`;
    const g = groups.get(key);
    if (g) g.minutes += it.minutes;
    else groups.set(key, { employeeId: it.employee_id, wage: it.hourly_wage, minutes: it.minutes });
  }

  const out = new Map<string, PaidSum>();
  groups.forEach((g) => {
    const cur = out.get(g.employeeId) ?? { minutes: 0, amount: 0 };
    cur.minutes += g.minutes;
    cur.amount += calcSalary(g.wage, g.minutes);
    out.set(g.employeeId, cur);
  });
  return out;
}

/** 오늘 (KST, YYYY-MM-DD) — 지급일 기본값·상한 */
export const todayKSTString = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
