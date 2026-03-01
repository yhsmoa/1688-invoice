'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import './Payroll.css';

// ============================================================
// 타입 정의
// ============================================================

interface Employee {
  id: string;
  name: string | null;
  name_kr: string | null;
  hourly_wage: number | null;
  bank_name: string | null;
  bank_no: string | null;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  work_date: string;        // YYYY-MM-DD
  clock_in: string | null;  // ISO timestamp
  clock_out: string | null; // ISO timestamp
  total_minutes: number | null;
}

// ============================================================
// 유틸 함수
// ============================================================

/** ISO timestamp → HH:MM (로컬 기준) */
const formatTime = (ts: string | null): string => {
  if (!ts) return '--:--';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

/** 분 → "8.5h" 형식 */
const minutesToHours = (minutes: number | null | undefined): string => {
  if (!minutes) return '-';
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
};

/** 시급 × 총분 → 예상 급여 (30분 내림이 적용된 total_minutes 기반) */
const calcWage = (hourlyWage: number | null, totalMinutes: number): string => {
  if (!hourlyWage || !totalMinutes) return '-';
  const wage = Math.floor((hourlyWage * totalMinutes) / 60);
  return `₩${wage.toLocaleString()}`;
};

/** 날짜(숫자) → 요일 인덱스 (0=일, 6=토) */
const getDayIndex = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getDay();

// ============================================================
// 메인 컴포넌트
// ============================================================
const Payroll: React.FC = () => {
  // ── 월 선택 (기본: 현재 년/월) ────────────────────────────
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // ── 데이터 상태 ───────────────────────────────────────────
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [records, setRecords]         = useState<AttendanceRecord[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(0);
  const [isLoading, setIsLoading]     = useState(false);

  // ── 정리 패널 표시 여부 ───────────────────────────────────
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // ── 이전/다음 월 네비게이션 ───────────────────────────────
  const goToPrevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else              { setMonth((m) => m - 1); }
  };

  const goToNextMonth = () => {
    const todayYear  = new Date().getFullYear();
    const todayMonth = new Date().getMonth() + 1;
    if (year === todayYear && month === todayMonth) return;
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else               { setMonth((m) => m + 1); }
  };

  const isCurrentMonth =
    year === new Date().getFullYear() && month === new Date().getMonth() + 1;

  // ── 데이터 조회 ───────────────────────────────────────────
  const fetchPayroll = useCallback(async (y: number, m: number) => {
    setIsLoading(true);
    setEmployees([]);
    setRecords([]);
    setIsSummaryOpen(false);
    try {
      const res    = await fetch(`/api/hr/payroll?year=${y}&month=${m}`);
      const result = await res.json();
      if (result.success) {
        setEmployees(result.employees);
        setRecords(result.records);
        setDaysInMonth(result.daysInMonth);
      }
    } catch (err) {
      console.error('급여장부 조회 오류:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayroll(year, month);
  }, [year, month, fetchPayroll]);

  // ============================================================
  // 데이터 가공
  // ============================================================

  /**
   * recordMap: Map<day(1~31), Map<employee_id, Record>>
   * 날짜 × 직원 O(1) 조회
   */
  const recordMap = useMemo(() => {
    const map = new Map<number, Map<string, AttendanceRecord>>();
    records.forEach((rec) => {
      const day = parseInt(rec.work_date.split('-')[2], 10);
      if (!map.has(day)) map.set(day, new Map());
      map.get(day)!.set(rec.employee_id, rec);
    });
    return map;
  }, [records]);

  /**
   * employeeTotals: Map<employee_id, total_minutes>
   * 직원별 월 총 근무 분
   */
  const employeeTotals = useMemo(() => {
    const totals = new Map<string, number>();
    records.forEach((rec) => {
      const prev = totals.get(rec.employee_id) ?? 0;
      totals.set(rec.employee_id, prev + (rec.total_minutes ?? 0));
    });
    return totals;
  }, [records]);

  /** 날짜 배열 [1 .. daysInMonth] */
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth]
  );

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="pr-main">

          {/* ============================================================
              근무 시간표 (전체 화면)
              ============================================================ */}
          <section className="pr-sheet-section">

            {/* ── 네비게이션 바 ── */}
            <div className="pr-nav-bar">
              <div className="pr-nav-left">
                <button className="pr-nav-btn" onClick={goToPrevMonth}>◀</button>
                <span className="pr-month-label">{year}년 {month}월</span>
                <button
                  className="pr-nav-btn"
                  onClick={goToNextMonth}
                  disabled={isCurrentMonth}
                >
                  ▶
                </button>
              </div>

              {/* 정리 버튼: 데이터가 있을 때만 표시 */}
              {!isLoading && employees.length > 0 && (
                <button
                  className="pr-summary-btn"
                  onClick={() => setIsSummaryOpen(true)}
                >
                  정리
                </button>
              )}
            </div>

            {/* ── 시간표 테이블 ── */}
            <div className="pr-table-wrapper">
              {isLoading ? (
                <div className="pr-state-msg">불러오는 중...</div>
              ) : employees.length === 0 ? (
                <div className="pr-state-msg">
                  {year}년 {month}월 근무 기록이 없습니다.
                </div>
              ) : (
                <table className="pr-table">
                  <thead>
                    {/* 1행: 날 (rowspan2) + 직원명 (colspan2) */}
                    <tr>
                      <th className="pr-th-date" rowSpan={2}>날</th>
                      {employees.map((emp) => (
                        <th key={emp.id} colSpan={2} className="pr-th-emp">
                          {emp.name_kr || emp.name || '-'}
                        </th>
                      ))}
                    </tr>
                    {/* 2행: 직원별 시간대 / 근무 서브헤더 */}
                    <tr>
                      {employees.flatMap((emp) => [
                        <th key={`${emp.id}-r`} className="pr-th-sub">시간</th>,
                        <th key={`${emp.id}-h`} className="pr-th-sub pr-th-h">h</th>,
                      ])}
                    </tr>
                  </thead>

                  <tbody>
                    {/* ── 일별 행 ── */}
                    {days.map((day) => {
                      const di         = getDayIndex(year, month, day);
                      const isSun      = di === 0;
                      const isSat      = di === 6;
                      const isWeekend  = isSun || isSat;
                      return (
                        <tr key={day} className={isWeekend ? 'pr-row-weekend' : ''}>
                          {/* 날짜 숫자 (주말 색상 구분) */}
                          <td className="pr-td-date">
                            <span className={
                              isSun ? 'pr-dn sun' :
                              isSat ? 'pr-dn sat' :
                                      'pr-dn'
                            }>
                              {day}
                            </span>
                          </td>

                          {/* 직원별 데이터 */}
                          {employees.flatMap((emp) => {
                            const rec       = recordMap.get(day)?.get(emp.id);
                            const timeRange = rec
                              ? `${formatTime(rec.clock_in)}~${formatTime(rec.clock_out)}`
                              : '';
                            const hours = rec ? minutesToHours(rec.total_minutes) : '';
                            return [
                              <td key={`${emp.id}-r`} className="pr-td-range">{timeRange}</td>,
                              <td key={`${emp.id}-h`} className="pr-td-h">{hours}</td>,
                            ];
                          })}
                        </tr>
                      );
                    })}

                    {/* ── 합계 행 ── */}
                    <tr className="pr-row-total">
                      <td className="pr-td-date">
                        <span className="pr-dn">합</span>
                      </td>
                      {employees.flatMap((emp) => {
                        const total = employeeTotals.get(emp.id) ?? 0;
                        return [
                          <td key={`${emp.id}-r`} className="pr-td-range" />,
                          <td key={`${emp.id}-h`} className="pr-td-h pr-total-h">
                            {total > 0 ? minutesToHours(total) : '-'}
                          </td>,
                        ];
                      })}
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ============================================================
              [정리] 슬라이드 패널 (오버레이)
              클릭 배경 또는 × 버튼으로 닫기
              ============================================================ */}
          {isSummaryOpen && (
            <div
              className="pr-overlay"
              onClick={() => setIsSummaryOpen(false)}
            >
              <aside
                className="pr-summary-panel"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 패널 헤더 */}
                <div className="pr-panel-header">
                  <h2 className="pr-panel-title">
                    {year}년 {month}월 급여 정산
                  </h2>
                  <button
                    className="pr-panel-close"
                    onClick={() => setIsSummaryOpen(false)}
                  >
                    ×
                  </button>
                </div>

                {/* 정산 테이블 */}
                <div className="pr-panel-body">
                  <table className="pr-summary-table">
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>한글명</th>
                        <th>시급</th>
                        <th>총 근무</th>
                        <th>예상 급여</th>
                        <th>은행</th>
                        <th>계좌번호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => {
                        const totalMinutes = employeeTotals.get(emp.id) ?? 0;
                        return (
                          <tr key={emp.id}>
                            <td>{emp.name || '-'}</td>
                            <td className="ps-name-kr">{emp.name_kr || '-'}</td>
                            <td className="ps-wage">
                              {emp.hourly_wage
                                ? `₩${emp.hourly_wage.toLocaleString()}`
                                : '-'}
                            </td>
                            <td className="ps-hours">
                              {totalMinutes > 0 ? minutesToHours(totalMinutes) : '-'}
                            </td>
                            <td className="ps-calc">
                              {calcWage(emp.hourly_wage, totalMinutes)}
                            </td>
                            <td>{emp.bank_name || '-'}</td>
                            <td className="ps-bankno">{emp.bank_no || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </aside>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default Payroll;
