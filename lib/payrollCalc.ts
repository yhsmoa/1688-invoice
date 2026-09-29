import { supabase } from './supabase';

// ============================================================
// payrollCalc — 월 급여 계산 (서버 전용)
//
//   급여장부(/api/hr/payroll) · 급여 엑셀(/api/hr/payroll/export-excel) ·
//   무역계좌 급여 반영(/api/trade-account/payroll/*) 이 같은 계산을 쓴다.
//   규칙이 바뀌면 여기 한 곳만 바꾼다.
//
//   · 출근기록: invoiceManager_emplyee_records, clock_in 있는 행만, 1000행 range 루프
//   · 예상 급여 = floor(시급 × 총분 / 60)  (시급 위안/시간)
// ============================================================

export interface PayrollRecord {
  id: string;
  employee_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_minutes: number | null;
}

export interface PayrollEmployee {
  id: string;
  name: string | null;
  name_kr: string | null;
  role: string | null;
  hourly_wage: number | null;
  bank_name: string | null;
  bank_no: string | null;
}

export interface PayrollMonth {
  year: number;
  month: number;
  daysInMonth: number;
  startDate: string;
  endDate: string;
  records: PayrollRecord[];
  /** 그 달 기록이 있는 직원 (이름순) */
  employees: PayrollEmployee[];
  /** 직원별 총 근무 분 */
  minutesByEmployee: Map<string, number>;
}

const PAGE = 1000;

/** 시급 × 총분 → 예상 급여 (내림). 시급·분이 없으면 0 */
export function calcSalary(hourlyWage: number | null | undefined, totalMinutes: number): number {
  if (!hourlyWage || hourlyWage <= 0 || !totalMinutes || totalMinutes <= 0) return 0;
  return Math.floor((hourlyWage * totalMinutes) / 60);
}

/** 연·월 검증 — 잘못되면 null */
export function parseYearMonth(yearParam: string | null, monthParam: string | null): { year: number; month: number } | null {
  if (!yearParam || !monthParam) return null;
  const year = parseInt(yearParam, 10);
  const month = parseInt(monthParam, 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
  return { year, month };
}

// ============================================================
// 월 급여 데이터 조회
// ============================================================
export async function fetchPayrollMonth(year: number, month: number): Promise<PayrollMonth> {
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const startDate = `${year}-${mm}-01`;
  const endDate = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

  // ── 출근기록 (1000행 우회) ──
  const records: PayrollRecord[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('invoiceManager_emplyee_records')
      .select('id, employee_id, work_date, clock_in, clock_out, total_minutes')
      .gte('work_date', startDate)
      .lte('work_date', endDate)
      .not('clock_in', 'is', null)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    records.push(...(data as PayrollRecord[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const minutesByEmployee = new Map<string, number>();
  for (const rec of records) {
    minutesByEmployee.set(rec.employee_id, (minutesByEmployee.get(rec.employee_id) ?? 0) + (rec.total_minutes ?? 0));
  }

  // ── 직원 정보 (기록 있는 직원만) ──
  let employees: PayrollEmployee[] = [];
  const employeeIds = [...minutesByEmployee.keys()];
  if (employeeIds.length > 0) {
    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr, role, hourly_wage, bank_name, bank_no')
      .in('id', employeeIds)
      .order('name');
    if (error) throw error;
    employees = (data ?? []) as PayrollEmployee[];
  }

  return { year, month, daysInMonth, startDate, endDate, records, employees, minutesByEmployee };
}
