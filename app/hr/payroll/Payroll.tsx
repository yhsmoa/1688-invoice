'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  clock_in: string | null;  // ISO timestamp (UTC)
  clock_out: string | null; // ISO timestamp (UTC)
  total_minutes: number | null;
}

/** 인라인 편집 중인 셀 상태 */
interface EditingCell {
  day: number;
  employeeId: string;
  recordId: string;
  workDate: string;   // YYYY-MM-DD (ISO 재조합에 사용)
  clockIn: string;    // HH:MM (로컬)
  clockOut: string;   // HH:MM (로컬)
  isSaving: boolean;
  error: string;
}

// ============================================================
// 유틸 함수
// ============================================================

/** ISO timestamp → "HH:MM" (로컬 시간, 빈값 시 빈문자열) */
const toLocalHHMM = (ts: string | null): string => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** ISO timestamp → "HH:MM" (표시용 fallback '--:--') */
const formatTime = (ts: string | null): string => toLocalHHMM(ts) || '--:--';

/** 분 → "8.5h" 형식 (null/0 → '-') */
const minutesToHours = (minutes: number | null | undefined): string => {
  if (!minutes) return '-';
  const h = minutes / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
};

/** 시급 × 총분 → 예상 급여 문자열 */
const calcWage = (hourlyWage: number | null, totalMinutes: number): string => {
  if (!hourlyWage || !totalMinutes) return '-';
  const wage = Math.floor((hourlyWage * totalMinutes) / 60);
  return `₩${wage.toLocaleString()}`;
};

/**
 * "HH:MM" 두 값으로 30분 내림 적용 근무 분 계산
 * 퇴근 <= 출근이면 null 반환
 */
const calcMinutesFromTimes = (clockIn: string, clockOut: string): number | null => {
  if (!clockIn || !clockOut) return null;
  const [inH, inM]   = clockIn.split(':').map(Number);
  const [outH, outM] = clockOut.split(':').map(Number);
  const total = (outH * 60 + outM) - (inH * 60 + inM);
  if (total <= 0) return null;
  return Math.floor(total / 30) * 30;
};

/** 날짜 → 요일 인덱스 (0=일, 6=토) */
const getDayIndex = (year: number, month: number, day: number): number =>
  new Date(year, month - 1, day).getDay();

// ============================================================
// 메인 컴포넌트
// ============================================================
const Payroll: React.FC = () => {

  // ============================================================
  // ① 잠금 화면 상태 (반드시 모든 hook보다 먼저, return 전에 선언)
  // ============================================================
  const [isUnlocked, setIsUnlocked]   = useState(false);
  const [lockCode, setLockCode]       = useState('');
  const [lockError, setLockError]     = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const lockInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // ② 급여장부 데이터 상태
  // ============================================================
  const now = new Date();
  const [year, setYear]               = useState(now.getFullYear());
  const [month, setMonth]             = useState(now.getMonth() + 1);
  const [employees, setEmployees]     = useState<Employee[]>([]);
  const [records, setRecords]         = useState<AttendanceRecord[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(0);
  const [isLoading, setIsLoading]     = useState(false);

  // ============================================================
  // ③ 인라인 편집 상태
  // ============================================================
  const [editing, setEditing] = useState<EditingCell | null>(null);

  // ============================================================
  // ④ 정리 패널 상태
  // ============================================================
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // ============================================================
  // ⑤ 잠금 해제: 8자리 코드 검증 (verify-access 재사용)
  // ============================================================
  const handleVerify = async () => {
    if (lockCode.length !== 8 || isVerifying) return;
    setIsVerifying(true);
    setLockError('');
    try {
      const res    = await fetch('/api/hr/verify-access', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: lockCode }),
      });
      const result = await res.json();
      if (result.success) {
        setIsUnlocked(true);
      } else {
        setLockError(result.error || '접근 권한이 없습니다.');
        setLockCode('');
        setTimeout(() => lockInputRef.current?.focus(), 50);
      }
    } catch {
      setLockError('서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  // ============================================================
  // ⑥ 월 네비게이션
  // ============================================================
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

  // ============================================================
  // ⑦ 데이터 조회 (isUnlocked가 true일 때만 실행)
  // ============================================================
  const fetchPayroll = useCallback(async (y: number, m: number) => {
    setIsLoading(true);
    setEmployees([]);
    setRecords([]);
    setEditing(null);
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
    if (!isUnlocked) return;
    fetchPayroll(year, month);
  }, [year, month, fetchPayroll, isUnlocked]);

  // ============================================================
  // ⑧ 데이터 가공 (useMemo - 항상 최상위에서 호출)
  // ============================================================

  /**
   * recordMap: Map<day, Map<employee_id, AttendanceRecord>>
   * 날짜(1~31) × 직원ID 기반 O(1) 조회
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
  // ⑨ 인라인 편집 핸들러
  // ============================================================

  /** 시간 셀 클릭 → 편집 시작 */
  const startEditing = (day: number, emp: Employee, rec: AttendanceRecord) => {
    setEditing({
      day,
      employeeId:  emp.id,
      recordId:    rec.id,
      workDate:    rec.work_date,
      clockIn:     toLocalHHMM(rec.clock_in),
      clockOut:    toLocalHHMM(rec.clock_out),
      isSaving:    false,
      error:       '',
    });
  };

  /** 편집 저장: ISO 재조합 → PUT update-time → 로컬 state 갱신 */
  const handleEditSave = async () => {
    if (!editing || editing.isSaving) return;

    const previewMins = calcMinutesFromTimes(editing.clockIn, editing.clockOut);
    if (previewMins === null) {
      setEditing((prev) => prev ? { ...prev, error: '퇴근 시간이 출근 시간보다 늦어야 합니다.' } : null);
      return;
    }

    setEditing((prev) => prev ? { ...prev, isSaving: true, error: '' } : null);

    try {
      // 클라이언트 로컬 시간 기준으로 ISO 재조합 (브라우저 timezone 적용)
      const clockInISO  = new Date(`${editing.workDate}T${editing.clockIn}:00`).toISOString();
      const clockOutISO = new Date(`${editing.workDate}T${editing.clockOut}:00`).toISOString();

      const res    = await fetch('/api/hr/attendance/update-time', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          record_id:    editing.recordId,
          clock_in_iso:  clockInISO,
          clock_out_iso: clockOutISO,
        }),
      });
      const result = await res.json();

      if (result.success) {
        // 로컬 records 배열에서 해당 레코드만 교체 (전체 재조회 없이 즉시 반영)
        setRecords((prev) => prev.map((r) => r.id === editing.recordId ? result.record : r));
        setEditing(null);
      } else {
        setEditing((prev) => prev ? { ...prev, isSaving: false, error: result.error || '저장에 실패했습니다.' } : null);
      }
    } catch {
      setEditing((prev) => prev ? { ...prev, isSaving: false, error: '서버 오류가 발생했습니다.' } : null);
    }
  };

  /** 편집 중 Enter/Escape 키 처리 */
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  handleEditSave();
    if (e.key === 'Escape') setEditing(null);
  };

  // ============================================================
  // ⑩ 잠금 화면 렌더링 (조건부 return - 모든 hook 선언 후에 위치)
  // ============================================================
  if (!isUnlocked) {
    return (
      <div className="app-layout">
        <TopsideMenu />
        <div className="main-content">
          <LeftsideMenu />
          <main className="pr-lock-main">
            <div className="pr-lock-card">
              <div className="pr-lock-icon">🔒</div>
              <h2 className="pr-lock-title">급여장부</h2>
              <p className="pr-lock-desc">접근 코드 8자리를 입력해주세요</p>
              <input
                ref={lockInputRef}
                type="password"
                className={`pr-lock-input ${lockError ? 'error' : ''}`}
                value={lockCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  if (val.length <= 8) setLockCode(val);
                  setLockError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                placeholder="••••••••"
                maxLength={8}
                autoFocus
                autoComplete="off"
              />
              {lockError && <p className="pr-lock-error">{lockError}</p>}
              <button
                className="pr-lock-btn"
                onClick={handleVerify}
                disabled={lockCode.length !== 8 || isVerifying}
              >
                {isVerifying ? '확인 중...' : '확인'}
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // ============================================================
  // ⑪ 급여장부 본문 렌더링
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

              {/* [정리] 버튼: 데이터 있을 때만 표시 */}
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
                <div className="pr-state-msg">{year}년 {month}월 근무 기록이 없습니다.</div>
              ) : (
                <table className="pr-table">

                  {/* ── colgroup: 날짜 고정 / 직원별 시간(flex) + h(고정) ── */}
                  <colgroup>
                    <col style={{ width: '36px' }} />
                    {employees.flatMap((_, i) => [
                      <col key={`col-r-${i}`} />,
                      <col key={`col-h-${i}`} style={{ width: '60px' }} />,
                    ])}
                  </colgroup>

                  <thead>
                    {/* 1행: 날 (rowspan=2) | 직원명 (colspan=2) */}
                    <tr>
                      <th className="pr-th-date" rowSpan={2}>날</th>
                      {employees.map((emp) => (
                        <th key={emp.id} colSpan={2} className="pr-th-emp">
                          {emp.name_kr || emp.name || '-'}
                        </th>
                      ))}
                    </tr>
                    {/* 2행: 시간대 / h 서브헤더 */}
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
                      const di        = getDayIndex(year, month, day);
                      const isSun     = di === 0;
                      const isSat     = di === 6;
                      const isWeekend = isSun || isSat;

                      return (
                        <tr key={day} className={isWeekend ? 'pr-row-weekend' : ''}>

                          {/* 날짜 숫자 셀 (주말 색상 구분) */}
                          <td className="pr-td-date">
                            <span className={`pr-dn${isSun ? ' sun' : isSat ? ' sat' : ''}`}>
                              {day}
                            </span>
                          </td>

                          {/* 직원별 시간대 + h 셀 */}
                          {employees.flatMap((emp) => {
                            const rec      = recordMap.get(day)?.get(emp.id);
                            const isEdit   = editing?.day === day && editing?.employeeId === emp.id;

                            if (isEdit) {
                              // ── 편집 모드: time 입력 + 실시간 h 미리보기 ──
                              const previewMins = calcMinutesFromTimes(editing.clockIn, editing.clockOut);
                              return [
                                <td key={`${emp.id}-r`} className="pr-td-range pr-td-editing">
                                  <div className="pr-edit-row">
                                    <input
                                      type="time"
                                      value={editing.clockIn}
                                      onChange={(e) =>
                                        setEditing((prev) =>
                                          prev ? { ...prev, clockIn: e.target.value } : null
                                        )
                                      }
                                      onKeyDown={handleEditKeyDown}
                                      className="pr-time-input"
                                      autoFocus
                                    />
                                    <span className="pr-edit-sep">~</span>
                                    <input
                                      type="time"
                                      value={editing.clockOut}
                                      onChange={(e) =>
                                        setEditing((prev) =>
                                          prev ? { ...prev, clockOut: e.target.value } : null
                                        )
                                      }
                                      onKeyDown={handleEditKeyDown}
                                      className="pr-time-input"
                                    />
                                    <button
                                      className="pr-edit-save"
                                      onClick={handleEditSave}
                                      disabled={editing.isSaving}
                                    >
                                      {editing.isSaving ? '…' : '✓'}
                                    </button>
                                    <button
                                      className="pr-edit-cancel"
                                      onClick={() => setEditing(null)}
                                    >
                                      ✗
                                    </button>
                                  </div>
                                  {editing.error && (
                                    <div className="pr-edit-error">{editing.error}</div>
                                  )}
                                </td>,
                                <td key={`${emp.id}-h`} className="pr-td-h pr-td-preview">
                                  {previewMins !== null ? minutesToHours(previewMins) : '-'}
                                </td>,
                              ];
                            }

                            // ── 일반 표시 모드 (기록 있으면 클릭 가능) ──
                            const timeRange = rec
                              ? `${formatTime(rec.clock_in)}~${formatTime(rec.clock_out)}`
                              : '';
                            const hours = rec ? minutesToHours(rec.total_minutes) : '';

                            return [
                              <td
                                key={`${emp.id}-r`}
                                className={`pr-td-range${rec ? ' pr-td-clickable' : ''}`}
                                onClick={rec ? () => startEditing(day, emp, rec) : undefined}
                              >
                                {timeRange}
                              </td>,
                              <td key={`${emp.id}-h`} className="pr-td-h">
                                {hours}
                              </td>,
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
              [정리] 슬라이드 패널 - 급여 정산 요약
              오버레이 배경 클릭 or × 버튼으로 닫기
              ============================================================ */}
          {isSummaryOpen && (
            <div className="pr-overlay" onClick={() => setIsSummaryOpen(false)}>
              <aside
                className="pr-summary-panel"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="pr-panel-header">
                  <h2 className="pr-panel-title">{year}년 {month}월 급여 정산</h2>
                  <button
                    className="pr-panel-close"
                    onClick={() => setIsSummaryOpen(false)}
                  >
                    ×
                  </button>
                </div>

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
                              {emp.hourly_wage ? `₩${emp.hourly_wage.toLocaleString()}` : '-'}
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
