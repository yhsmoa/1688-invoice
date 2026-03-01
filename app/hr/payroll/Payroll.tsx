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

/** 시간 수정/삭제 모달 상태 */
interface TimeModal {
  recordId: string;
  employeeName: string;
  workDate: string;      // YYYY-MM-DD
  clockIn: string;       // HH:MM (로컬)
  clockOut: string;      // HH:MM (로컬)
  isSaving: boolean;
  isDeleting: boolean;
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

/** YYYY-MM-DD + HH:MM → ISO string (브라우저 로컬 타임존 기준) */
const toISO = (date: string, time: string): string =>
  new Date(`${date}T${time}:00`).toISOString();

// ============================================================
// 메인 컴포넌트
// ============================================================
const Payroll: React.FC = () => {

  // ============================================================
  // ① 잠금 화면 상태
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
  // ③ 시간 수정/삭제 모달 상태
  // ============================================================
  const [modal, setModal] = useState<TimeModal | null>(null);

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
    setModal(null);
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

  /** 모달 열려있을 때 실시간 근무 시간 계산 */
  const modalPreviewMins = modal
    ? calcMinutesFromTimes(modal.clockIn, modal.clockOut)
    : null;

  // ============================================================
  // ⑨ 시간 수정/삭제 모달 핸들러
  // ============================================================

  /** 시간 셀 클릭 → 모달 열기 */
  const openModal = (emp: Employee, rec: AttendanceRecord) => {
    setModal({
      recordId:     rec.id,
      employeeName: emp.name_kr || emp.name || '-',
      workDate:     rec.work_date,
      clockIn:      toLocalHHMM(rec.clock_in),
      clockOut:     toLocalHHMM(rec.clock_out),
      isSaving:     false,
      isDeleting:   false,
      error:        '',
    });
  };

  /** 저장: 출퇴근 시간 수정 → PUT /api/hr/attendance/update-time */
  const handleModalSave = async () => {
    if (!modal || modal.isSaving || modal.isDeleting) return;

    if (modalPreviewMins === null) {
      setModal((prev) => prev ? { ...prev, error: '퇴근 시간이 출근 시간보다 늦어야 합니다.' } : null);
      return;
    }

    setModal((prev) => prev ? { ...prev, isSaving: true, error: '' } : null);
    try {
      const res    = await fetch('/api/hr/attendance/update-time', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          record_id:     modal.recordId,
          clock_in_iso:  toISO(modal.workDate, modal.clockIn),
          clock_out_iso: toISO(modal.workDate, modal.clockOut),
        }),
      });
      const result = await res.json();
      if (result.success) {
        // 전체 재조회 없이 해당 레코드만 즉시 교체
        setRecords((prev) => prev.map((r) => r.id === modal.recordId ? result.record : r));
        setModal(null);
      } else {
        setModal((prev) => prev ? { ...prev, isSaving: false, error: result.error || '저장에 실패했습니다.' } : null);
      }
    } catch {
      setModal((prev) => prev ? { ...prev, isSaving: false, error: '서버 오류가 발생했습니다.' } : null);
    }
  };

  /** 삭제: 출퇴근 기록 삭제 → DELETE /api/hr/attendance/[id] */
  const handleModalDelete = async () => {
    if (!modal || modal.isSaving || modal.isDeleting) return;
    if (!confirm('이 출퇴근 기록을 삭제하시겠습니까?')) return;

    setModal((prev) => prev ? { ...prev, isDeleting: true, error: '' } : null);
    try {
      const res    = await fetch(`/api/hr/attendance/${modal.recordId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        setRecords((prev) => prev.filter((r) => r.id !== modal.recordId));
        setModal(null);
      } else {
        setModal((prev) => prev ? { ...prev, isDeleting: false, error: result.error || '삭제에 실패했습니다.' } : null);
      }
    } catch {
      setModal((prev) => prev ? { ...prev, isDeleting: false, error: '서버 오류가 발생했습니다.' } : null);
    }
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

                  {/* colgroup: 날짜 고정 / 직원별 시간(flex) + h(고정) */}
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
                    {/* 2행: 시간 / h 서브헤더 */}
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

                          {/* 직원별 시간대 + h 셀 (기록 있으면 클릭 → 모달) */}
                          {employees.flatMap((emp) => {
                            const rec = recordMap.get(day)?.get(emp.id);
                            return [
                              <td
                                key={`${emp.id}-r`}
                                className={`pr-td-range${rec ? ' pr-td-clickable' : ''}`}
                                onClick={rec ? () => openModal(emp, rec) : undefined}
                              >
                                {rec ? `${formatTime(rec.clock_in)}~${formatTime(rec.clock_out)}` : ''}
                              </td>,
                              <td key={`${emp.id}-h`} className="pr-td-h">
                                {rec ? minutesToHours(rec.total_minutes) : ''}
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
              시간 수정/삭제 모달
              - 시간 셀 클릭 시 열림 / 오버레이 클릭 or × 버튼으로 닫기
              - 출근·퇴근 시간 수정 + 실시간 근무 시간 미리보기
              - 삭제 버튼으로 해당 출퇴근 기록 삭제
              ============================================================ */}
          {modal && (
            <div className="pr-modal-overlay" onClick={() => setModal(null)}>
              <div className="pr-modal" onClick={(e) => e.stopPropagation()}>

                {/* 모달 헤더 */}
                <div className="pr-modal-header">
                  <div>
                    <h3 className="pr-modal-title">근무 시간 수정</h3>
                    <p className="pr-modal-sub">
                      {modal.workDate.replace(/-/g, '.')} · {modal.employeeName}
                    </p>
                  </div>
                  <button className="pr-modal-close" onClick={() => setModal(null)}>×</button>
                </div>

                {/* 모달 바디: 출근/퇴근 입력 + 미리보기 */}
                <div className="pr-modal-body">

                  <div className="pr-modal-field">
                    <label className="pr-modal-label">출근</label>
                    <input
                      type="time"
                      className="pr-modal-time"
                      value={modal.clockIn}
                      autoFocus
                      onChange={(e) =>
                        setModal((prev) => prev ? { ...prev, clockIn: e.target.value, error: '' } : null)
                      }
                    />
                  </div>

                  <div className="pr-modal-field">
                    <label className="pr-modal-label">퇴근</label>
                    <input
                      type="time"
                      className="pr-modal-time"
                      value={modal.clockOut}
                      onChange={(e) =>
                        setModal((prev) => prev ? { ...prev, clockOut: e.target.value, error: '' } : null)
                      }
                    />
                  </div>

                  {/* 실시간 근무 시간 미리보기 */}
                  <div className="pr-modal-preview">
                    <span className="pr-modal-preview-label">근무 시간</span>
                    <span className={`pr-modal-preview-val${modalPreviewMins === null ? ' invalid' : ''}`}>
                      {modalPreviewMins !== null ? minutesToHours(modalPreviewMins) : '—'}
                    </span>
                  </div>

                  {/* 에러 메시지 */}
                  {modal.error && <p className="pr-modal-error">{modal.error}</p>}
                </div>

                {/* 모달 푸터: [삭제] 왼쪽 / [취소][저장] 오른쪽 */}
                <div className="pr-modal-footer">
                  <button
                    className="pr-modal-btn-delete"
                    onClick={handleModalDelete}
                    disabled={modal.isSaving || modal.isDeleting}
                  >
                    {modal.isDeleting ? '삭제 중...' : '삭제'}
                  </button>
                  <div className="pr-modal-footer-right">
                    <button
                      className="pr-modal-btn-cancel"
                      onClick={() => setModal(null)}
                      disabled={modal.isSaving || modal.isDeleting}
                    >
                      취소
                    </button>
                    <button
                      className="pr-modal-btn-save"
                      onClick={handleModalSave}
                      disabled={modal.isSaving || modal.isDeleting}
                    >
                      {modal.isSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}

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
