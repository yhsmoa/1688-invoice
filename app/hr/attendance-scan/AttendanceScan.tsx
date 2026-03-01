'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import './AttendanceScan.css';

// ============================================================
// 타입 정의
// ============================================================
interface FoundEmployee {
  id: string;
  name: string | null;
  name_kr: string | null;
}

interface AttendanceRecord {
  id: string;
  clock_in: string | null;
  clock_out: string | null;
  total_minutes: number | null;
}

interface DailyRecord {
  id: string;
  employee_id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  total_minutes: number | null;
  name: string | null;
  name_kr: string | null;
}

// 버튼 활성화 상태 타입
type ButtonStatus = 'clock-in' | 'clock-out' | 'complete' | null;

// ============================================================
// 유틸 함수
// ============================================================

/** 날짜를 YYYY-MM-DD 형식으로 반환 (로컬 기준) */
const toLocalDateString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** timestamp → HH:MM 형식 */
const formatTime = (ts: string | null): string => {
  if (!ts) return '-';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

/** total_minutes → "8.5시간" 형식 */
const formatTotalHours = (minutes: number | null): string => {
  if (minutes === null || minutes === undefined) return '-';
  const hours = minutes / 60;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)}시간`;
};

/** 버튼 상태 결정: 오늘 기록에 따라 어떤 버튼을 보여줄지 */
const determineButtonStatus = (record: AttendanceRecord | null): ButtonStatus => {
  if (!record || !record.clock_in) return 'clock-in';   // 기록 없음 → 출근
  if (record.clock_in && !record.clock_out) return 'clock-out'; // 출근만 있음 → 퇴근
  return 'complete'; // 둘 다 있음 → 완료
};

// ============================================================
// 메인 컴포넌트
// ============================================================
const AttendanceScan: React.FC = () => {
  // ── 스캐너 영역 상태 ───────────────────────────────────────
  const [codeInput, setCodeInput] = useState('');
  const [employee, setEmployee] = useState<FoundEmployee | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [buttonStatus, setButtonStatus] = useState<ButtonStatus>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isActing, setIsActing] = useState(false);

  // ── 일별 기록 영역 상태 ────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString(new Date()));
  const [dailyRecords, setDailyRecords] = useState<DailyRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 자동 리셋 타이머 정리 ──────────────────────────────────
  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  // ============================================================
  // 일별 기록 로드 (날짜 변경 시 자동 호출)
  // ============================================================
  const fetchDailyRecords = useCallback(async (date: string) => {
    setIsLoadingRecords(true);
    try {
      const res = await fetch(`/api/hr/attendance/daily?date=${date}`);
      const result = await res.json();
      if (result.success) {
        setDailyRecords(result.records);
      }
    } catch (err) {
      console.error('일별 기록 로드 오류:', err);
    } finally {
      setIsLoadingRecords(false);
    }
  }, []);

  useEffect(() => {
    fetchDailyRecords(selectedDate);
  }, [selectedDate, fetchDailyRecords]);

  // ============================================================
  // 스캐너 초기화 (입력폼 + 직원 정보 리셋)
  // ============================================================
  const resetScanner = () => {
    setCodeInput('');
    setEmployee(null);
    setTodayRecord(null);
    setButtonStatus(null);
    setLookupError('');
    setActionMessage('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ============================================================
  // 코드 입력 → 직원 조회
  // ============================================================
  const handleLookup = async () => {
    if (codeInput.length !== 8) return;
    setIsLookingUp(true);
    setLookupError('');
    setEmployee(null);
    setTodayRecord(null);
    setButtonStatus(null);

    try {
      const today = toLocalDateString(new Date());
      const res = await fetch('/api/hr/attendance/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeInput, date: today }),
      });
      const result = await res.json();

      if (result.success) {
        setEmployee(result.employee);
        setTodayRecord(result.record);
        setButtonStatus(determineButtonStatus(result.record));
      } else {
        setLookupError(result.error || '직원을 찾을 수 없습니다.');
        setCodeInput('');
        inputRef.current?.focus();
      }
    } catch {
      setLookupError('서버 오류가 발생했습니다.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleLookup();
  };

  // ============================================================
  // 출근 IN 처리
  // ============================================================
  const handleClockIn = async () => {
    if (!employee || isActing) return;
    setIsActing(true);

    try {
      const today = toLocalDateString(new Date());
      const res = await fetch('/api/hr/attendance/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id, date: today }),
      });
      const result = await res.json();

      if (result.success) {
        setTodayRecord(result.record);
        setButtonStatus('clock-out');
        setActionMessage(`✅ 출근 완료! ${formatTime(result.record.clock_in)}`);
        fetchDailyRecords(today);
        // 3초 후 자동 초기화
        resetTimerRef.current = setTimeout(resetScanner, 3000);
      } else {
        setActionMessage(`❌ ${result.error}`);
      }
    } catch {
      setActionMessage('❌ 서버 오류가 발생했습니다.');
    } finally {
      setIsActing(false);
    }
  };

  // ============================================================
  // 퇴근 OUT 처리
  // ============================================================
  const handleClockOut = async () => {
    if (!employee || !todayRecord || isActing) return;
    setIsActing(true);

    try {
      const res = await fetch('/api/hr/attendance/clock-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: todayRecord.id }),
      });
      const result = await res.json();

      if (result.success) {
        setTodayRecord(result.record);
        setButtonStatus('complete');
        const hours = formatTotalHours(result.record.total_minutes);
        setActionMessage(`✅ 퇴근 완료! ${formatTime(result.record.clock_out)} (${hours})`);
        fetchDailyRecords(toLocalDateString(new Date()));
        // 3초 후 자동 초기화
        resetTimerRef.current = setTimeout(resetScanner, 3000);
      } else {
        setActionMessage(`❌ ${result.error}`);
      }
    } catch {
      setActionMessage('❌ 서버 오류가 발생했습니다.');
    } finally {
      setIsActing(false);
    }
  };

  // ============================================================
  // 날짜 네비게이션
  // ============================================================
  const goToPrevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setSelectedDate(toLocalDateString(d));
  };

  const goToNextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const today = toLocalDateString(new Date());
    if (toLocalDateString(d) <= today) {
      setSelectedDate(toLocalDateString(d));
    }
  };

  const isToday = selectedDate === toLocalDateString(new Date());

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="as-main">

          {/* ============================================================
              스캐너 영역
              ============================================================ */}
          <section className="as-scanner-section">
            <h1 className="as-scanner-title">출퇴근 스캔</h1>
            <p className="as-scanner-desc">8자리 코드를 입력하고 Enter를 누르세요</p>

            {/* 코드 입력폼 */}
            <div className="as-input-wrapper">
              <input
                ref={inputRef}
                type="password"
                className={`as-code-input ${lookupError ? 'error' : ''}`}
                value={codeInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  if (val.length <= 8) {
                    setCodeInput(val);
                    setLookupError('');
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="••••••••"
                maxLength={8}
                autoFocus
                autoComplete="off"
              />
              {isLookingUp && <span className="as-input-spinner">⏳</span>}
            </div>

            {/* 오류 메시지 */}
            {lookupError && (
              <p className="as-error-msg">{lookupError}</p>
            )}

            {/* 직원 정보 + 버튼 영역 */}
            {employee && (
              <div className="as-employee-card">
                <div className="as-employee-name">
                  <span className="as-name-kr">{employee.name_kr || employee.name || '-'}</span>
                  {employee.name && employee.name_kr && (
                    <span className="as-name-en">{employee.name}</span>
                  )}
                </div>

                {/* 액션 메시지 */}
                {actionMessage && (
                  <p className={`as-action-msg ${actionMessage.startsWith('✅') ? 'success' : 'fail'}`}>
                    {actionMessage}
                  </p>
                )}

                {/* 출근/퇴근 버튼 */}
                {!actionMessage && (
                  <div className="as-btn-group">
                    {/* 출근 IN 버튼 */}
                    <button
                      className={`as-action-btn as-btn-in ${buttonStatus === 'clock-in' ? 'active' : 'disabled'}`}
                      onClick={handleClockIn}
                      disabled={buttonStatus !== 'clock-in' || isActing}
                    >
                      <span className="as-btn-icon">🟢</span>
                      <span className="as-btn-label">출근 IN</span>
                    </button>

                    {/* 퇴근 OUT 버튼 */}
                    <button
                      className={`as-action-btn as-btn-out ${buttonStatus === 'clock-out' ? 'active' : 'disabled'}`}
                      onClick={handleClockOut}
                      disabled={buttonStatus !== 'clock-out' || isActing}
                    >
                      <span className="as-btn-icon">🔴</span>
                      <span className="as-btn-label">퇴근 OUT</span>
                    </button>
                  </div>
                )}

                {/* 이미 완료 상태 */}
                {buttonStatus === 'complete' && !actionMessage && (
                  <p className="as-complete-msg">✅ 오늘 출퇴근이 완료되었습니다.</p>
                )}

                {/* 취소 버튼 */}
                <button className="as-cancel-btn" onClick={resetScanner}>
                  취소
                </button>
              </div>
            )}
          </section>

          {/* ============================================================
              일별 출근 기록 테이블
              ============================================================ */}
          <section className="as-records-section">
            {/* 날짜 네비게이션 */}
            <div className="as-date-nav">
              <button className="as-date-btn" onClick={goToPrevDay}>◀</button>
              <span className="as-date-label">
                {selectedDate}
                {isToday && <span className="as-today-badge">오늘</span>}
              </span>
              <button
                className="as-date-btn"
                onClick={goToNextDay}
                disabled={isToday}
              >
                ▶
              </button>
            </div>

            {/* 기록 테이블 */}
            <div className="as-table-wrapper">
              {isLoadingRecords ? (
                <div className="as-loading">불러오는 중...</div>
              ) : (
                <table className="as-table">
                  <thead>
                    <tr>
                      <th>이름 (한국어)</th>
                      <th>이름 (영문)</th>
                      <th>출근 시간</th>
                      <th>퇴근 시간</th>
                      <th>근무 시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="as-empty">
                          {selectedDate} 출근 기록이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      dailyRecords.map((record) => (
                        <tr
                          key={record.id}
                          className={!record.clock_out ? 'as-row-working' : ''}
                        >
                          <td>{record.name_kr || '-'}</td>
                          <td>{record.name || '-'}</td>
                          <td className="as-time-cell">{formatTime(record.clock_in)}</td>
                          <td className="as-time-cell">
                            {record.clock_out
                              ? formatTime(record.clock_out)
                              : <span className="as-working-badge">근무중</span>
                            }
                          </td>
                          <td className="as-time-cell">
                            {formatTotalHours(record.total_minutes)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </main>
      </div>
    </div>
  );
};

export default AttendanceScan;
