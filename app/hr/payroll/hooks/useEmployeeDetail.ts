'use client';

import { useCallback, useRef, useState } from 'react';
import type { Employee } from '../../employees/utils/employeeFields';

// ============================================================
// useEmployeeDetail — 급여장부에서 직원 이름을 누르면 직원관리와 같은 상세 슬라이드를 연다
//
//   · 급여장부 API(/api/hr/payroll)는 급여 계산에 필요한 칼럼만 주므로,
//     상세 슬라이드에 필요한 전체 정보는 직원관리 목록 API(/api/hr/employees)에서 받는다
//   · 열 때마다 새로 받는다 — 직원관리에서 방금 고친 내용도 바로 보이게
//   · 다른 직원을 연달아 누르면 마지막으로 누른 직원만 연다 (늦게 온 응답 무시)
// ============================================================
export function useEmployeeDetail() {
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  /** 불러오는 중인 직원 id — 헤더에 로딩 표시용 */
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const openDetail = useCallback(async (employeeId: string) => {
    const seq = ++requestSeqRef.current;
    setLoadingId(employeeId);
    try {
      const res    = await fetch('/api/hr/employees');
      const result = await res.json();
      if (seq !== requestSeqRef.current) return;
      if (!res.ok || !result.success) {
        alert(result.error || '직원 정보를 불러오지 못했습니다.');
        return;
      }
      const found = (result.data as Employee[]).find((e) => e.id === employeeId);
      if (!found) {
        alert('직원 정보를 찾을 수 없습니다.');
        return;
      }
      setDetailEmployee(found);
    } catch (err) {
      console.error('직원 상세 조회 오류:', err);
      if (seq === requestSeqRef.current) alert('직원 정보를 불러오는 중 오류가 발생했습니다.');
    } finally {
      if (seq === requestSeqRef.current) setLoadingId(null);
    }
  }, []);

  const closeDetail = useCallback(() => {
    requestSeqRef.current++;          // 진행 중인 조회가 닫은 뒤에 슬라이드를 다시 열지 않게
    setLoadingId(null);
    setDetailEmployee(null);
  }, []);

  return { detailEmployee, setDetailEmployee, loadingId, openDetail, closeDetail };
}
