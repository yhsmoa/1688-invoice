'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import EmployeeAddModal from './components/EmployeeAddModal';
import EmployeeDetailSlide from './components/EmployeeDetailSlide';
import {
  ROLE_OPTIONS,
  LEGACY_ROLE_LABEL_KEYS,
  STATUS_ORDER,
  ROLE_ORDER,
  rankOf,
  formatDate,
  formatBirthWithAge,
  type Employee,
} from './utils/employeeFields';
import './EmployeeManagement.css';

const ITEMS_PER_PAGE = 50;

// ============================================================
// 직원관리 — 잠금 해제(8자리 코드) → 목록 · 검색 · 상세 슬라이드 · 추가 모달
//   상세/추가 UI: components/EmployeeDetailSlide · EmployeeAddModal
//   필드·선택지 정의: utils/employeeFields
//   다국어: hr.employees.* (locales/ko.json · zh.json)
// ============================================================
const EmployeeManagement: React.FC = () => {
  const { t } = useTranslation();

  // ── 잠금 상태 ──────────────────────────────────────────────
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [lockError, setLockError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const lockInputRef = useRef<HTMLInputElement>(null);

  // ── 직원 목록 상태 ─────────────────────────────────────────
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // ── 상세 슬라이드 · 추가 모달 ──────────────────────────────
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // ============================================================
  // 잠금 해제: 8자리 코드 검증
  // ============================================================
  const handleVerifyCode = async () => {
    if (codeInput.length !== 8) {
      setLockError(t('hr.employees.lock.errLength'));
      return;
    }
    setIsVerifying(true);
    setLockError('');
    try {
      const res = await fetch('/api/hr/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeInput }),
      });
      const result = await res.json();
      if (result.success) {
        setIsUnlocked(true);
        setCodeInput('');
      } else {
        // 서버 문구는 한국어 고정 — 화면에는 번역 문구
        setLockError(t('hr.employees.lock.denied'));
        setCodeInput('');
        setTimeout(() => lockInputRef.current?.focus(), 50);
      }
    } catch {
      setLockError(t('hr.employees.serverError'));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleVerifyCode();
  };

  // ============================================================
  // 직원 목록 로드
  // ============================================================
  const fetchEmployees = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/hr/employees');
      const result = await res.json();
      if (result.success) {
        setEmployees(result.data);
      }
    } catch (err) {
      console.error('직원 목록 로드 오류:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isUnlocked) fetchEmployees();
  }, [isUnlocked]);

  // ============================================================
  // 검색 + 정렬 + 페이지네이션 (프론트엔드)
  // ============================================================
  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = !q
      ? employees
      : employees.filter(
          (e) =>
            (e.name && e.name.toLowerCase().includes(q)) ||
            (e.name_kr && e.name_kr.toLowerCase().includes(q))
        );

    // 정렬: 상태 → 직책 → 입사일(오름차순, 빈값은 뒤로)
    return [...base].sort((a, b) => {
      const s = rankOf(STATUS_ORDER, a.status) - rankOf(STATUS_ORDER, b.status);
      if (s !== 0) return s;
      const r = rankOf(ROLE_ORDER, a.role) - rankOf(ROLE_ORDER, b.role);
      if (r !== 0) return r;
      const ah = a.hire_date || '';
      const bh = b.hire_date || '';
      if (ah && bh) return ah.localeCompare(bh);
      if (ah) return -1; // 입사일 있는 쪽 먼저
      if (bh) return 1;
      return 0;
    });
  }, [employees, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / ITEMS_PER_PAGE));
  const pagedEmployees = filteredEmployees.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  // ── 표시 라벨 (값은 한국어/영문 그대로 저장, 표시는 번역) ──
  const roleLabel = (role: string | null) => {
    if (!role) return '-';
    const labelKey = ROLE_OPTIONS.find((o) => o.value === role)?.labelKey ?? LEGACY_ROLE_LABEL_KEYS[role];
    return labelKey ? t(`hr.employees.roles.${labelKey}`) : role;
  };
  const statusLabel = (status: string | null) =>
    status ? t(`hr.employees.statuses.${status}`, { defaultValue: status }) : '-';

  // ── 상세 저장 결과 반영 ──
  const handleUpdated = (updated: Employee) => {
    setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setSelectedEmployee(updated);
  };

  // ============================================================
  // 잠금 화면
  // ============================================================
  if (!isUnlocked) {
    return (
      <div className="app-layout">
        <TopsideMenu />
        <div className="main-content">
          <LeftsideMenu />
          <main className="em-lock-main">
            <div className="em-lock-card">
              <div className="em-lock-icon">🔒</div>
              <h2 className="em-lock-title">{t('hr.employees.title')}</h2>
              <p className="em-lock-desc">{t('hr.employees.lock.desc')}</p>
              <input
                ref={lockInputRef}
                type="password"
                className={`em-lock-input ${lockError ? 'error' : ''}`}
                value={codeInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  if (val.length <= 8) setCodeInput(val);
                  setLockError('');
                }}
                onKeyDown={handleCodeKeyDown}
                placeholder="••••••••"
                maxLength={8}
                autoFocus
                autoComplete="off"
              />
              {lockError && <p className="em-lock-error">{lockError}</p>}
              <button
                className="em-lock-btn"
                onClick={handleVerifyCode}
                disabled={isVerifying || codeInput.length !== 8}
              >
                {isVerifying ? t('hr.employees.lock.verifying') : t('hr.employees.lock.confirm')}
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // ============================================================
  // 직원관리 메인 화면
  // ============================================================
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="em-main">
          {/* ── 페이지 헤더 ── */}
          <div className="em-page-header">
            <h1 className="em-page-title">{t('hr.employees.title')}</h1>
            <button className="em-add-btn" onClick={() => setIsAddModalOpen(true)}>
              {t('hr.employees.addButton')}
            </button>
          </div>

          {/* ── 검색 ── */}
          <div className="em-search-bar">
            <input
              type="text"
              className="em-search-input"
              placeholder={t('hr.employees.searchPlaceholder')}
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </div>

          {/* ── 테이블 ── */}
          <div className="em-table-wrapper">
            {isLoading ? (
              <div className="em-loading">{t('hr.employees.loading')}</div>
            ) : (
              <table className="em-table">
                <thead>
                  <tr>
                    <th>{t('hr.employees.table.name')}</th>
                    <th>{t('hr.employees.table.role')}</th>
                    <th>{t('hr.employees.table.status')}</th>
                    <th>{t('hr.employees.table.birth')}</th>
                    <th>{t('hr.employees.table.hire')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="em-empty">{t('hr.employees.empty')}</td>
                    </tr>
                  ) : (
                    pagedEmployees.map((emp) => (
                      <tr
                        key={emp.id}
                        className="em-table-row"
                        onClick={() => setSelectedEmployee(emp)}
                      >
                        <td>{[emp.name, emp.name_kr].filter(Boolean).join(' | ') || '-'}</td>
                        <td>{roleLabel(emp.role)}</td>
                        <td>
                          <span className={`em-status-badge em-status-${emp.status || 'none'}`}>
                            {statusLabel(emp.status)}
                          </span>
                        </td>
                        <td>{formatBirthWithAge(emp.birth_date)}</td>
                        <td>{formatDate(emp.hire_date)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* ── 페이지네이션 ── */}
          {!isLoading && filteredEmployees.length > ITEMS_PER_PAGE && (
            <div className="em-pagination">
              <button
                className="em-page-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                ◀
              </button>
              <span className="em-page-info">
                {currentPage} / {totalPages}
              </span>
              <button
                className="em-page-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                ▶
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ── 상세 슬라이드 ── */}
      <EmployeeDetailSlide
        employee={selectedEmployee}
        onClose={() => setSelectedEmployee(null)}
        onUpdated={handleUpdated}
      />

      {/* ── 추가 모달 — 저장 후 목록을 다시 받아 이미지 경로까지 반영 ── */}
      <EmployeeAddModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdded={() => fetchEmployees()}
      />
    </div>
  );
};

export default EmployeeManagement;
