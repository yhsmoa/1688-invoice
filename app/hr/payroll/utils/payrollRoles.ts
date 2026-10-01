// ============================================================
// 급여장부 — 업무(직책)별 정렬 · 그룹 · 표시명
//   순서는 직원관리와 같은 ROLE_ORDER (매니저 → 검수 → 포장 → 단기 아르바이트),
//   같은 직책 안에서는 API 순서(이름순) 유지 — Array.prototype.sort 는 안정 정렬
// ============================================================
import { ROLE_ORDER, rankOf } from '../../employees/utils/employeeFields';

// ── 화면 표시용 짧은 직책명 (DB 값은 그대로) ──
const ROLE_SHORT_LABEL: Record<string, string> = {
  '단기 아르바이트': '단기',
};

/** 직책이 비어 있는 직원 그룹 표시명 */
const NO_ROLE_LABEL = '미지정';

export const roleLabel = (role: string | null): string =>
  role ? (ROLE_SHORT_LABEL[role] ?? role) : NO_ROLE_LABEL;

/** 직책 순서로 정렬 (원본 배열은 건드리지 않음) */
export const sortByRole = <T extends { role: string | null }>(employees: T[]): T[] =>
  [...employees].sort((a, b) => rankOf(ROLE_ORDER, a.role) - rankOf(ROLE_ORDER, b.role));

// ── 직책 그룹 (정렬된 배열의 연속 구간) ──
export interface RoleGroup<T> {
  role: string | null;
  label: string;
  employees: T[];
}

export const groupByRole = <T extends { role: string | null }>(sorted: T[]): RoleGroup<T>[] => {
  const groups: RoleGroup<T>[] = [];
  for (const emp of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.role === emp.role) last.employees.push(emp);
    else groups.push({ role: emp.role, label: roleLabel(emp.role), employees: [emp] });
  }
  return groups;
};
