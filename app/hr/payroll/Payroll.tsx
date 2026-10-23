'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import { groupByRole, sortByRole } from './utils/payrollRoles';
import { birthdayInThisWeek, todayKSTDate, type BirthdayInWeek } from './utils/birthday';
import { useDragScroll } from './hooks/useDragScroll';
import { calcSalary, paidByEmployee, todayKSTString, type PaidItem } from './utils/payrollPaid';
import MarkPaidModal, { type MarkPaidRow } from './components/MarkPaidModal';
import './Payroll.css';

// ============================================================
// 타입 정의
// ============================================================

interface Employee {
  id: string;
  name: string | null;
  name_kr: string | null;
  role: string | null;
  hourly_wage: number | null;
  bank_name: string | null;
  bank_no: string | null;
  birth_date: string | null;   // YYYY-MM-DD — 생일 주간 👑
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  work_date: string;        // YYYY-MM-DD
  clock_in: string | null;  // ISO timestamp (UTC)
  clock_out: string | null; // ISO timestamp (UTC)
  total_minutes: number | null;
}

/** 시간 수정/삭제/추가 모달 상태 */
interface TimeModal {
  recordId: string;      // 수정 시 사용 (추가 시 빈 문자열)
  employeeId: string;    // 추가 시 사용
  employeeName: string;
  workDate: string;      // YYYY-MM-DD
  clockIn: string;       // HH:MM (로컬)
  clockOut: string;      // HH:MM (로컬)
  isCreate: boolean;     // true = 신규 추가 / false = 수정
  isSaving: boolean;
  isDeleting: boolean;
  error: string;
  /** 급여 지급완료된 기록이면 지급 정보 — 수정·삭제 잠금, [지급 취소]만 가능 */
  paid: PaidItem | null;
  isCancelingPaid: boolean;
}

/** [급여지급완료] 확인 모달 상태 */
interface MarkPaidState {
  paidDate: string;      // YYYY-MM-DD
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

/** 시급 × 총분 → 예상 급여 문자열 (원화기호 제외) */
const calcWage = (hourlyWage: number | null, totalMinutes: number): string => {
  if (!hourlyWage || !totalMinutes) return '-';
  const wage = Math.floor((hourlyWage * totalMinutes) / 60);
  return wage.toLocaleString();
};

/**
 * "HH:MM" 두 값으로 근무 분 계산
 *   1. 점심시간 공제: 12:00-13:00 구간과 겹치는 분 차감
 *   2. 30분 단위 내림(floor)
 *   퇴근 <= 출근이면 null 반환
 */
const calcMinutesFromTimes = (clockIn: string, clockOut: string): number | null => {
  if (!clockIn || !clockOut) return null;
  const [inH, inM]   = clockIn.split(':').map(Number);
  const [outH, outM] = clockOut.split(':').map(Number);
  const inMin  = inH  * 60 + inM;
  const outMin = outH * 60 + outM;
  const total  = outMin - inMin;
  if (total <= 0) return null;

  // ── 점심시간(12:00-13:00) 공제 ───────────────────────────────
  const LUNCH_START = 12 * 60; // 720
  const LUNCH_END   = 13 * 60; // 780
  const overlapStart   = Math.max(inMin, LUNCH_START);
  const overlapEnd     = Math.min(outMin, LUNCH_END);
  const lunchDeduction = Math.max(0, overlapEnd - overlapStart);

  const net = total - lunchDeduction;
  if (net <= 0) return null;
  return Math.floor(net / 30) * 30;
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
  /** 급여 지급완료 항목 (활성) — 시간 셀 ✓ · 정리 패널 지급/미지급 */
  const [paidItems, setPaidItems]     = useState<PaidItem[]>([]);

  // ============================================================
  // ③ 시간 수정/삭제 모달 상태
  // ============================================================
  const [modal, setModal] = useState<TimeModal | null>(null);

  // ============================================================
  // ④ 정리 패널 상태
  // ============================================================
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);

  // ============================================================
  // ④-0 시간표 드래그 이동 — 표를 잡고 끌면 가로·세로 스크롤
  //   (훅은 잠금 화면 return 보다 위에서 호출해야 한다)
  // ============================================================
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const { onMouseDown: onTableMouseDown, isPanning } = useDragScroll(tableWrapperRef);

  // ============================================================
  // ④-1 엑셀 다운로드 / 부분엑셀(시간 셀 선택)
  //   · [엑셀]     : GET  — 해당 월 전체 (부분엑셀 모드면 POST — 선택한 출근기록만)
  //   · [월급엑셀] : GET scope=unpaid — 지급완료된 시간을 뺀 나머지
  // ============================================================
  const [isExporting, setIsExporting] = useState(false);

  /** 부분엑셀 모드 — true 면 시간 셀 클릭이 '선택'으로 동작 (수정 모달 대신) */
  const [isPartialMode, setIsPartialMode] = useState(false);

  /** 선택된 출근기록 id 집합 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /** [급여지급완료] 확인 모달 */
  const [markPaid, setMarkPaid] = useState<MarkPaidState | null>(null);

  /** [부분엑셀] ↔ [취소] 토글 — 취소 시 선택 초기화 */
  const togglePartialMode = () => {
    if (isPartialMode) {
      setIsPartialMode(false);
      setSelectedIds(new Set());
    } else {
      setIsPartialMode(true);
    }
  };

  /** 시간 셀 선택/해제 (다중) — 지급완료된 시간은 선택하지 않는다 (이중 지급 방지) */
  const toggleSelect = (recordId: string) => {
    if (paidMap.has(recordId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else                    next.add(recordId);
      return next;
    });
  };

  /** 엑셀 응답 → 파일 저장 */
  const saveExcel = async (res: Response, fileName: string) => {
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * 엑셀 다운로드
   *   kind 'sheet'  : [엑셀] — 부분엑셀 모드면 선택분, 아니면 해당 월 전체
   *   kind 'unpaid' : [월급엑셀] — 지급완료된 시간을 뺀 나머지
   */
  const handleExcelExport = async (kind: 'sheet' | 'unpaid') => {
    if (isExporting) return;

    // 부분엑셀 모드인데 선택이 없으면 중단
    if (kind === 'sheet' && isPartialMode && selectedIds.size === 0) {
      alert('부분엑셀로 만들 시간을 먼저 선택해 주세요.');
      return;
    }

    const isPartial = kind === 'sheet' && isPartialMode && selectedIds.size > 0;
    const mm = String(month).padStart(2, '0');
    setIsExporting(true);
    try {
      const res = isPartial
        ? await fetch('/api/hr/payroll/export-excel', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ year, month, recordIds: [...selectedIds] }),
          })
        : await fetch(
            `/api/hr/payroll/export-excel?year=${year}&month=${month}${kind === 'unpaid' ? '&scope=unpaid' : ''}`
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '엑셀 생성에 실패했습니다.');
        return;
      }
      const label = kind === 'unpaid' ? '월급' : isPartial ? '급여_부분' : '급여';
      await saveExcel(res, `${year}년_${mm}월_${label}.xlsx`);
    } catch {
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

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
  //   requestSeqRef — 늦게 도착한 이전 요청 응답이 최신 화면을 덮지 않도록 순번으로 거른다
  //                   (월을 빠르게 넘기거나, 지급 처리 후 재조회 중 월을 바꾼 경우)
  // ============================================================
  const requestSeqRef = useRef(0);
  /** 지금 화면에 띄운(또는 불러오는 중인) 연·월 — 늦게 끝난 지급 처리의 재조회가 다른 달을 덮지 않게 */
  const viewKeyRef = useRef('');

  /** 응답 적용 — 업무별 순서 (매니저 → 검수 → 포장 → 단기) 는 시간표·정리 패널 공통 */
  const applyPayroll = (result: {
    employees: Employee[]; records: AttendanceRecord[]; daysInMonth: number; paidItems?: PaidItem[];
  }) => {
    setEmployees(sortByRole(result.employees));
    setRecords(result.records);
    setDaysInMonth(result.daysInMonth);
    setPaidItems(result.paidItems ?? []);
  };

  const fetchPayroll = useCallback(async (y: number, m: number) => {
    const seq = ++requestSeqRef.current;
    viewKeyRef.current = `${y}-${m}`;
    setIsLoading(true);
    setEmployees([]);
    setRecords([]);
    setPaidItems([]);
    setModal(null);
    setMarkPaid(null);
    setIsSummaryOpen(false);
    // 월이 바뀌면 이전 달 기록 id 가 남지 않도록 부분엑셀 선택 해제
    setIsPartialMode(false);
    setSelectedIds(new Set());
    try {
      const res    = await fetch(`/api/hr/payroll?year=${y}&month=${m}`);
      const result = await res.json();
      if (seq !== requestSeqRef.current) return;
      if (result.success) applyPayroll(result);
    } catch (err) {
      console.error('급여장부 조회 오류:', err);
    } finally {
      if (seq === requestSeqRef.current) setIsLoading(false);
    }
  }, []);

  /**
   * 화면을 비우지 않고 다시 읽기 — 지급완료·지급 취소 뒤 DB 기준으로 맞춘다
   *   (지급 금액은 DB 의 시급 스냅샷으로 계산하므로 로컬 값으로 흉내 내지 않는다)
   */
  const reloadSilently = async () => {
    // 처리 중에 다른 달로 넘어갔으면 그 달은 fetchPayroll 이 이미 새로 읽는다 → 건너뜀
    //   (여기서 순번을 올리면 진행 중인 fetchPayroll 의 로딩 해제가 막힌다)
    if (viewKeyRef.current !== `${year}-${month}`) return;
    const seq = ++requestSeqRef.current;
    try {
      const res    = await fetch(`/api/hr/payroll?year=${year}&month=${month}`);
      const result = await res.json();
      if (seq !== requestSeqRef.current) return;
      if (result.success) applyPayroll(result);
    } catch (err) {
      console.error('급여장부 재조회 오류:', err);
    }
  };

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

  /** 업무(직책) 그룹 — 시간표 상단 그룹 헤더 */
  const roleGroups = useMemo(() => groupByRole(employees), [employees]);

  /** 생일 주간 직원 — 오늘(KST)이 속한 주(월~일)에 생일이 있으면 헤더에 👑 */
  const birthdayMap = useMemo(() => {
    const today = todayKSTDate();
    const map = new Map<string, BirthdayInWeek>();
    employees.forEach((emp) => {
      const b = birthdayInThisWeek(emp.birth_date, today);
      if (b) map.set(emp.id, b);
    });
    return map;
  }, [employees]);

  /** 그룹 첫 직원 id — 그룹 경계 세로선 */
  const groupStartIds = useMemo(
    () => new Set(roleGroups.map((g) => g.employees[0].id)),
    [roleGroups]
  );

  /** 날짜 배열 [1 .. daysInMonth] */
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth]
  );

  /** 지급완료 항목: record_id → 지급 정보 (시간 셀 ✓ · 선택 차단 · 모달 잠금) */
  const paidMap = useMemo(() => {
    const map = new Map<string, PaidItem>();
    paidItems.forEach((p) => map.set(p.record_id, p));
    return map;
  }, [paidItems]);

  /** 직원별 지급완료 합계 — 정리 패널 지급완료/미지급 */
  const paidTotals = useMemo(() => paidByEmployee(paidItems), [paidItems]);

  /** 모달 열려있을 때 실시간 근무 시간 계산 */
  const modalPreviewMins = modal
    ? calcMinutesFromTimes(modal.clockIn, modal.clockOut)
    : null;

  // ============================================================
  // ⑧-1 [급여지급완료] — 부분엑셀 모드에서 고른 시간을 지급완료로 표시
  //   · 버튼을 처음 누르면 선택 모드로 들어간다 (부분엑셀과 같은 선택을 공유)
  //   · 확인 모달에서 직원별 금액·지급일을 보고 확정 → DB 함수가 한 트랜잭션으로 기록
  // ============================================================

  /** 선택한 기록 (지급완료된 것은 선택 단계에서 이미 빠짐) */
  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id) && !paidMap.has(r.id)),
    [records, selectedIds, paidMap]
  );

  /** 확인 모달 — 직원별 일수·시간·금액 (금액 = floor(시급 × 선택 시간 합 / 60)) */
  const markPaidRows = useMemo<MarkPaidRow[]>(() => {
    const byEmp = new Map<string, { days: number; minutes: number }>();
    selectedRecords.forEach((r) => {
      const cur = byEmp.get(r.employee_id) ?? { days: 0, minutes: 0 };
      cur.days += 1;
      cur.minutes += r.total_minutes ?? 0;
      byEmp.set(r.employee_id, cur);
    });
    return employees
      .filter((emp) => byEmp.has(emp.id))
      .map((emp) => {
        const s = byEmp.get(emp.id)!;
        return {
          employeeId: emp.id,
          name: emp.name || emp.name_kr || '-',
          nameKr: emp.name_kr,
          days: s.days,
          minutes: s.minutes,
          hourlyWage: emp.hourly_wage,
          amount: calcSalary(emp.hourly_wage, s.minutes),
        };
      });
  }, [selectedRecords, employees]);

  /** 지급일 하한 — 선택한 가장 늦은 근무일 */
  const markPaidMinDate = useMemo(
    () => selectedRecords.reduce((max, r) => (r.work_date > max ? r.work_date : max), ''),
    [selectedRecords]
  );

  const handleMarkPaidClick = () => {
    if (!isPartialMode) {
      setIsPartialMode(true);           // 선택 모드로 진입 — 안내 문구가 표시된다
      return;
    }
    if (selectedRecords.length === 0) {
      alert('급여 지급완료로 표시할 시간을 먼저 선택해 주세요.');
      return;
    }
    // 퇴근 기록 없는(근무 0분) 시간은 지급완료할 수 없다 — DB 도 같은 규칙으로 막는다
    const open = selectedRecords.filter((r) => !r.clock_out || !r.total_minutes);
    if (open.length > 0) {
      alert(`퇴근 기록이 없거나 근무 시간이 0 인 시간 ${open.length}건이 선택되어 있습니다.\n해당 시간을 빼고 다시 시도해 주세요.`);
      return;
    }
    const today = todayKSTString();
    setMarkPaid({
      paidDate: markPaidMinDate > today ? markPaidMinDate : today,
      isSaving: false,
      error:    '',
    });
  };

  const handleMarkPaidConfirm = async () => {
    if (!markPaid || markPaid.isSaving) return;
    setMarkPaid((prev) => prev ? { ...prev, isSaving: true, error: '' } : null);
    try {
      const res = await fetch('/api/hr/payroll/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          record_ids: selectedRecords.map((r) => r.id),
          paid_date:  markPaid.paidDate,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        setMarkPaid((prev) => prev ? { ...prev, isSaving: false, error: result.error || '지급완료 처리에 실패했습니다.' } : null);
        // 다른 사람이 먼저 처리했을 수 있다 (409) → 화면을 DB 기준으로 맞춘다
        if (res.status === 409) await reloadSilently();
        return;
      }
      setMarkPaid(null);
      setIsPartialMode(false);
      setSelectedIds(new Set());
      await reloadSilently();
    } catch {
      setMarkPaid((prev) => prev ? { ...prev, isSaving: false, error: '서버 오류가 발생했습니다.' } : null);
    }
  };

  /** 수정 모달의 [지급 취소] — 이 시간만 취소, 취소 후 바로 수정할 수 있게 모달 유지 */
  const handleCancelPaid = async () => {
    if (!modal || !modal.paid || modal.isCancelingPaid) return;
    if (!confirm(`${modal.workDate.replace(/-/g, '.')} ${modal.employeeName} 의 급여 지급완료를 취소하시겠습니까?\n취소하면 이 시간은 다시 수정·지급할 수 있습니다.`)) return;

    setModal((prev) => prev ? { ...prev, isCancelingPaid: true, error: '' } : null);
    try {
      const res = await fetch('/api/hr/payroll/payments/cancel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ record_ids: [modal.recordId] }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        setModal((prev) => prev ? { ...prev, isCancelingPaid: false, error: result.error || '지급 취소에 실패했습니다.' } : null);
        if (res.status === 409) await reloadSilently();
        return;
      }
      setModal((prev) => prev ? { ...prev, paid: null, isCancelingPaid: false } : null);
      await reloadSilently();
    } catch {
      setModal((prev) => prev ? { ...prev, isCancelingPaid: false, error: '서버 오류가 발생했습니다.' } : null);
    }
  };

  // ============================================================
  // ⑨ 시간 수정/삭제 모달 핸들러
  // ============================================================

  /** 기존 기록 셀 클릭 → 수정 모달 열기 (지급완료된 기록은 잠금 상태로 열림) */
  const openModal = (emp: Employee, rec: AttendanceRecord) => {
    setModal({
      recordId:     rec.id,
      employeeId:   emp.id,
      employeeName: emp.name_kr || emp.name || '-',
      workDate:     rec.work_date,
      clockIn:      toLocalHHMM(rec.clock_in),
      clockOut:     toLocalHHMM(rec.clock_out),
      isCreate:     false,
      isSaving:     false,
      isDeleting:   false,
      error:        '',
      paid:         paidMap.get(rec.id) ?? null,
      isCancelingPaid: false,
    });
  };

  /** 빈 셀 클릭 → 신규 추가 모달 열기 */
  const openCreateModal = (emp: Employee, day: number) => {
    const workDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setModal({
      recordId:     '',
      employeeId:   emp.id,
      employeeName: emp.name_kr || emp.name || '-',
      workDate,
      clockIn:      '',
      clockOut:     '',
      isCreate:     true,
      isSaving:     false,
      isDeleting:   false,
      error:        '',
      paid:         null,
      isCancelingPaid: false,
    });
  };

  /** 저장: 신규 추가(isCreate) or 수정 분기 */
  const handleModalSave = async () => {
    if (!modal || modal.isSaving || modal.isDeleting || modal.isCancelingPaid) return;
    // 지급완료된 기록은 잠금 — 먼저 [지급 취소] (DB 트리거도 같은 규칙으로 막는다)
    if (modal.paid) return;

    // 출근 시간 필수 검증
    if (!modal.clockIn) {
      setModal((prev) => prev ? { ...prev, error: '출근 시간을 입력해주세요.' } : null);
      return;
    }

    // clockOut이 입력된 경우 대소 비교 검증
    if (modal.clockOut && modalPreviewMins === null) {
      setModal((prev) => prev ? { ...prev, error: '퇴근 시간이 출근 시간보다 늦어야 합니다.' } : null);
      return;
    }

    setModal((prev) => prev ? { ...prev, isSaving: true, error: '' } : null);

    try {
      let res: Response;

      if (modal.isCreate) {
        // ── 신규 추가: POST /api/hr/attendance/create ─────────
        res = await fetch('/api/hr/attendance/create', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            employee_id:   modal.employeeId,
            work_date:     modal.workDate,
            clock_in_iso:  toISO(modal.workDate, modal.clockIn),
            clock_out_iso: modal.clockOut ? toISO(modal.workDate, modal.clockOut) : null,
          }),
        });
      } else {
        // ── 기존 수정: PUT /api/hr/attendance/update-time ─────
        res = await fetch('/api/hr/attendance/update-time', {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            record_id:     modal.recordId,
            clock_in_iso:  toISO(modal.workDate, modal.clockIn),
            // clockOut이 없으면 null 전달 → API에서 clock_out 유지
            clock_out_iso: modal.clockOut ? toISO(modal.workDate, modal.clockOut) : null,
          }),
        });
      }

      const result = await res.json();
      if (result.success) {
        if (modal.isCreate) {
          // 신규 레코드 → 목록에 추가
          setRecords((prev) => [...prev, result.record]);
        } else {
          // 기존 레코드 → 해당 레코드만 교체
          setRecords((prev) => prev.map((r) => r.id === modal.recordId ? result.record : r));
        }
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
    if (!modal || modal.isSaving || modal.isDeleting || modal.isCancelingPaid) return;
    if (modal.paid) return;   // 지급완료된 기록은 잠금
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
                {/* 이번 달 지급완료 건수 */}
                {!isLoading && paidItems.length > 0 && (
                  <span className="pr-paid-count">✓ 지급완료 {paidItems.length}건</span>
                )}
                {/* 선택 모드 안내 */}
                {isPartialMode && (
                  <span className="pr-select-hint">
                    시간을 눌러 선택 → [엑셀] 부분 급여 엑셀 · [급여지급완료] 지급 표시 (✓ 지급완료된 시간은 선택 안 됨)
                  </span>
                )}
              </div>

              {/* 버튼: 데이터 있을 때만 표시
                  · 평소     : [정리] [부분엑셀] [급여지급완료] [월급엑셀] [엑셀]
                  · 선택 모드 : [취소(n)] [급여지급완료] [엑셀(선택분)] */}
              {!isLoading && employees.length > 0 && (
                <div className="pr-nav-actions">
                  {!isPartialMode && (
                    <button
                      className="pr-summary-btn"
                      onClick={() => setIsSummaryOpen(true)}
                    >
                      정리
                    </button>
                  )}
                  {/* [부분엑셀] ↔ [취소]: 켜면 시간 셀을 다중 선택할 수 있다 */}
                  <button
                    className={`pr-partial-btn${isPartialMode ? ' pr-partial-active' : ''}`}
                    onClick={togglePartialMode}
                  >
                    {isPartialMode
                      ? `취소${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`
                      : '부분엑셀'}
                  </button>
                  {/* [급여지급완료]: 평소엔 선택 모드로 진입, 선택 모드에선 확인 모달 */}
                  <button
                    className="pr-paid-btn"
                    onClick={handleMarkPaidClick}
                    disabled={isPartialMode && selectedRecords.length === 0}
                    title={isPartialMode ? '선택한 시간을 급여 지급완료로 표시' : '지급완료로 표시할 시간을 선택합니다'}
                  >
                    급여지급완료
                  </button>
                  {!isPartialMode && (
                    <button
                      className="pr-monthly-btn"
                      onClick={() => handleExcelExport('unpaid')}
                      disabled={isExporting}
                      title="지급완료된 시간을 뺀 나머지로 급여 엑셀"
                    >
                      월급엑셀
                    </button>
                  )}
                  <button
                    className="pr-excel-btn"
                    onClick={() => handleExcelExport('sheet')}
                    disabled={isExporting}
                    title={isPartialMode ? '선택한 시간만 급여 엑셀' : '이번 달 전체 급여 엑셀 (지급완료 포함)'}
                  >
                    {isExporting ? '생성 중...' : '엑셀'}
                  </button>
                </div>
              )}
            </div>

            {/* ── 시간표 테이블 — 잡고 끌어서 좌우·상하 이동 (useDragScroll) ── */}
            <div
              ref={tableWrapperRef}
              className={`pr-table-wrapper${isPanning ? ' is-panning' : ''}`}
              onMouseDown={onTableMouseDown}
            >
              {isLoading ? (
                <div className="pr-state-msg">불러오는 중...</div>
              ) : employees.length === 0 ? (
                <div className="pr-state-msg">{year}년 {month}월 근무 기록이 없습니다.</div>
              ) : (
                <table className="pr-table">

                  {/* colgroup: 날짜 고정 / 직원별 시간(내용 폭 그대로, 생략 없음) + h(고정) */}
                  <colgroup>
                    <col style={{ width: '36px' }} />
                    {employees.flatMap((_, i) => [
                      <col key={`col-r-${i}`} />,
                      <col key={`col-h-${i}`} style={{ width: '52px' }} />,
                    ])}
                  </colgroup>

                  <thead>
                    {/* 1행: 날 (rowspan=3) | 업무 그룹 (colspan=직원수×2) */}
                    <tr>
                      <th className="pr-th-date" rowSpan={3}>날</th>
                      {roleGroups.map((group) => (
                        <th
                          key={group.role ?? '__none'}
                          colSpan={group.employees.length * 2}
                          className="pr-th-group"
                        >
                          {group.label}
                          <span className="pr-th-group-count">{group.employees.length}</span>
                        </th>
                      ))}
                    </tr>
                    {/* 2행: 직원명 (colspan=2) — 생일 주간이면 👑 + 금빛 효과 */}
                    <tr>
                      {employees.map((emp) => {
                        const birthday = birthdayMap.get(emp.id);
                        return (
                        <th
                          key={emp.id}
                          colSpan={2}
                          className={`pr-th-emp${groupStartIds.has(emp.id) ? ' pr-group-start' : ''}${birthday ? ' pr-th-birthday' : ''}`}
                          title={birthday ? `🎂 이번 주 생일 (${birthday.month}/${birthday.day})` : undefined}
                        >
                          <div className="pr-th-name-row">
                            {birthday && <span className="pr-crown" aria-label="생일 주간">👑</span>}
                            <span>{emp.name || '-'}</span>
                          </div>
                          {/* 한글명 */}
                          {emp.name_kr && (
                            <div className="pr-th-name-kr">{emp.name_kr}</div>
                          )}
                        </th>
                        );
                      })}
                    </tr>
                    {/* 3행: 시간 / h 서브헤더 */}
                    <tr>
                      {employees.flatMap((emp) => [
                        <th
                          key={`${emp.id}-r`}
                          className={`pr-th-sub${groupStartIds.has(emp.id) ? ' pr-group-start' : ''}`}
                        >
                          시간
                        </th>,
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

                          {/* 직원별 시간대 + h 셀
                              - 일반 모드   : 시간 셀 — 기록 있으면 수정 모달 / 없으면 신규 추가 모달
                                              (지급완료된 기록은 잠금 모달 — [지급 취소]만 가능)
                              - 부분엑셀 모드: 시간·h 두 칸이 한 쌍 — 어느 칸을 눌러도 같이 선택/해제
                                              (기록 없는 칸·지급완료된 칸은 선택 불가)
                              - 지급완료    : 두 칸 연초록 + 시간 옆 ✓ */}
                          {employees.flatMap((emp) => {
                            const rec = recordMap.get(day)?.get(emp.id);
                            const groupStart = groupStartIds.has(emp.id) ? ' pr-group-start' : '';
                            const paid       = rec ? paidMap.get(rec.id) : undefined;
                            const paidCls    = paid ? ' pr-td-paid' : '';

                            // 부분엑셀 모드에서는 기록 있고 지급 안 된 셀만 선택 대상
                            const pickable   = isPartialMode && !!rec && !paid;
                            const clickable  = isPartialMode ? pickable : true;
                            const isSelected = !!rec && selectedIds.has(rec.id);
                            const selected   = isSelected ? ' pr-td-selected' : '';
                            // 빈 셀 hover 강조는 일반 모드에서만
                            const empty      = !rec && !isPartialMode ? ' pr-td-empty' : '';
                            // 선택 모드에서 지급완료 칸은 선택 불가 표시
                            const locked     = isPartialMode && paid ? ' pr-td-locked' : '';
                            // 부분엑셀 모드의 h 칸도 시간 칸과 같은 선택 대상
                            const hPick      = pickable ? ' pr-td-clickable pr-td-pair' : '';

                            const onCellClick = isPartialMode
                              ? (pickable ? () => toggleSelect(rec!.id) : undefined)
                              : (rec ? () => openModal(emp, rec) : () => openCreateModal(emp, day));

                            return [
                              <td
                                key={`${emp.id}-r`}
                                className={`pr-td-range${clickable ? ' pr-td-clickable' : ''}${pickable ? ' pr-td-pair' : ''}${empty}${groupStart}${paidCls}${locked}${selected}`}
                                onClick={onCellClick}
                                title={paid ? `급여 지급완료 · 지급일 ${paid.paid_date}` : undefined}
                              >
                                {rec ? `${formatTime(rec.clock_in)}~${formatTime(rec.clock_out)}` : ''}
                                {paid && <span className="pr-paid-check" aria-label="급여 지급완료">✓</span>}
                              </td>,
                              <td
                                key={`${emp.id}-h`}
                                className={`pr-td-h${hPick}${paidCls}${locked}${selected}`}
                                onClick={pickable ? () => toggleSelect(rec!.id) : undefined}
                              >
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
                          <td
                            key={`${emp.id}-r`}
                            className={`pr-td-range${groupStartIds.has(emp.id) ? ' pr-group-start' : ''}`}
                          />,
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
              - 급여 지급완료된 기록: 입력 잠금 + [지급 취소]만 (취소하면 바로 수정 가능)
              ============================================================ */}
          {modal && (
            <div className="pr-modal-overlay" onClick={() => !modal.isCancelingPaid && setModal(null)}>
              <div className="pr-modal" onClick={(e) => e.stopPropagation()}>

                {/* 모달 헤더 */}
                <div className="pr-modal-header">
                  <div>
                    <h3 className="pr-modal-title">
                      {modal.isCreate ? '근무 시간 추가' : modal.paid ? '근무 시간 (지급완료)' : '근무 시간 수정'}
                    </h3>
                    <p className="pr-modal-sub">
                      {modal.workDate.replace(/-/g, '.')} · {modal.employeeName}
                    </p>
                  </div>
                  <button className="pr-modal-close" onClick={() => setModal(null)} disabled={modal.isCancelingPaid}>×</button>
                </div>

                {/* 모달 바디: 출근/퇴근 입력 + 미리보기 */}
                <div className="pr-modal-body">

                  {/* 지급완료 안내 — 수정·삭제 잠금 */}
                  {modal.paid && (
                    <div className="pr-modal-paid">
                      <span className="pr-modal-paid-badge">✓ 급여 지급완료</span>
                      <span className="pr-modal-paid-date">지급일 {modal.paid.paid_date}</span>
                      <p className="pr-modal-paid-desc">시간을 고치거나 삭제하려면 먼저 지급을 취소하세요.</p>
                    </div>
                  )}

                  <div className="pr-modal-field">
                    <label className="pr-modal-label">출근</label>
                    <input
                      type="time"
                      className="pr-modal-time"
                      value={modal.clockIn}
                      autoFocus={!modal.paid}
                      disabled={!!modal.paid}
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
                      disabled={!!modal.paid}
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

                {/* 모달 푸터
                    · 지급완료 : [지급 취소] 왼쪽 / [닫기] 오른쪽
                    · 그 외   : [삭제] 왼쪽(수정 시만) / [취소][저장] 오른쪽 */}
                {modal.paid ? (
                  <div className="pr-modal-footer">
                    <button
                      className="pr-modal-btn-unpay"
                      onClick={handleCancelPaid}
                      disabled={modal.isCancelingPaid}
                    >
                      {modal.isCancelingPaid ? '취소 중...' : '지급 취소'}
                    </button>
                    <div className="pr-modal-footer-right">
                      <button
                        className="pr-modal-btn-cancel"
                        onClick={() => setModal(null)}
                        disabled={modal.isCancelingPaid}
                      >
                        닫기
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pr-modal-footer">
                    {!modal.isCreate && (
                      <button
                        className="pr-modal-btn-delete"
                        onClick={handleModalDelete}
                        disabled={modal.isSaving || modal.isDeleting}
                      >
                        {modal.isDeleting ? '삭제 중...' : '삭제'}
                      </button>
                    )}
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
                )}

              </div>
            </div>
          )}

          {/* ============================================================
              [급여지급완료] 확인 모달 — 직원별 금액 + 지급일
              ============================================================ */}
          {markPaid && (
            <MarkPaidModal
              rows={markPaidRows}
              paidDate={markPaid.paidDate}
              minDate={markPaidMinDate}
              maxDate={todayKSTString()}
              isSaving={markPaid.isSaving}
              error={markPaid.error}
              onChangeDate={(d) => setMarkPaid((prev) => prev ? { ...prev, paidDate: d, error: '' } : null)}
              onConfirm={handleMarkPaidConfirm}
              onClose={() => setMarkPaid(null)}
            />
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
                        <th>지급완료</th>
                        <th>미지급</th>
                        <th>은행</th>
                        <th>계좌번호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => {
                        const totalMinutes = employeeTotals.get(emp.id) ?? 0;
                        // 지급완료 = 지급 시점 시급(스냅샷) 기준 / 미지급 = 남은 시간 × 현재 시급 ([월급엑셀] 과 같은 값)
                        const paid          = paidTotals.get(emp.id);
                        const unpaidMinutes = Math.max(0, totalMinutes - (paid?.minutes ?? 0));
                        const unpaidAmount  = calcSalary(emp.hourly_wage, unpaidMinutes);
                        return (
                          <tr key={emp.id}>
                            <td>{emp.name || '-'}</td>
                            <td className="ps-name-kr">{emp.name_kr || '-'}</td>
                            <td className="ps-wage">
                              {emp.hourly_wage ? emp.hourly_wage.toLocaleString() : '-'}
                            </td>
                            <td className="ps-hours">
                              {totalMinutes > 0 ? minutesToHours(totalMinutes) : '-'}
                            </td>
                            <td className="ps-calc">
                              {calcWage(emp.hourly_wage, totalMinutes)}
                            </td>
                            <td className="ps-paid">
                              {paid ? `${paid.amount.toLocaleString()} (${minutesToHours(paid.minutes)})` : '-'}
                            </td>
                            <td className="ps-unpaid">
                              {unpaidMinutes > 0 ? unpaidAmount.toLocaleString() : '-'}
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
