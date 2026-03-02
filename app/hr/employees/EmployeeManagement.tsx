'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import './EmployeeManagement.css';

// ============================================================
// 타입 정의
// ============================================================
interface Employee {
  id: string;
  created_at: string;
  name: string | null;
  name_kr: string | null;
  identification: string | null;
  birth_date: string | null;
  phone: string | null;
  address: string | null;
  wechat: string | null;
  hourly_wage: number | null;
  status: string | null;
  hire_date: string | null;
  resigned_date: string | null;
  bank_name: string | null;
  bank_no: string | null;
  role: string | null;
  note: string | null;
  access_authorization: boolean | null;
  code: string | null;
}

type EditableFields = Omit<Employee, 'id' | 'created_at' | 'access_authorization' | 'code'>;

const ITEMS_PER_PAGE = 10;

// 필드 레이블 정의
const FIELD_LABELS: Record<string, string> = {
  name: '이름',
  name_kr: '이름 (한국어)',
  identification: '주민번호 / 신분증',
  birth_date: '생년월일',
  phone: '연락처',
  address: '주소',
  wechat: '위챗 ID',
  hourly_wage: '시급',
  status: '상태',
  hire_date: '입사일',
  resigned_date: '퇴사일',
  bank_name: '은행명',
  bank_no: '계좌번호',
  role: '직책',
  note: '비고',
  access_authorization: '접근 권한',
  created_at: '등록일',
};

const EMPTY_FORM: EditableFields = {
  name: '',
  name_kr: '',
  identification: '',
  birth_date: '',
  phone: '',
  address: '',
  wechat: '',
  hourly_wage: null,
  status: '',
  hire_date: '',
  resigned_date: '',
  bank_name: '',
  bank_no: '',
  role: '',
  note: '',
};

// ============================================================
// 메인 컴포넌트
// ============================================================
const EmployeeManagement: React.FC = () => {
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

  // ── 슬라이드 상세 모달 상태 ────────────────────────────────
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditableFields>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  // ── 추가 모달 상태 ─────────────────────────────────────────
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState<EditableFields>(EMPTY_FORM);
  const [isAdding, setIsAdding] = useState(false);

  // ============================================================
  // 잠금 해제: 8자리 코드 검증
  // ============================================================
  const handleVerifyCode = async () => {
    if (codeInput.length !== 8) {
      setLockError('8자리 숫자를 입력해주세요.');
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
        setLockError(result.error || '접근이 거부되었습니다.');
        setCodeInput('');
        setTimeout(() => lockInputRef.current?.focus(), 50);
      }
    } catch {
      setLockError('서버 오류가 발생했습니다.');
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
  // 검색 + 페이지네이션 (프론트엔드 필터링)
  // ============================================================
  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        (e.name && e.name.toLowerCase().includes(q)) ||
        (e.name_kr && e.name_kr.toLowerCase().includes(q))
    );
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

  // ============================================================
  // 슬라이드 상세 모달
  // ============================================================
  const handleRowClick = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsEditMode(false);
    setIsDetailOpen(true);
  };

  const handleDetailClose = () => {
    setIsDetailOpen(false);
    setIsEditMode(false);
    setSelectedEmployee(null);
  };

  const handleEditStart = () => {
    if (!selectedEmployee) return;
    setEditForm({
      name: selectedEmployee.name || '',
      name_kr: selectedEmployee.name_kr || '',
      identification: selectedEmployee.identification || '',
      birth_date: selectedEmployee.birth_date || '',
      phone: selectedEmployee.phone || '',
      address: selectedEmployee.address || '',
      wechat: selectedEmployee.wechat || '',
      hourly_wage: selectedEmployee.hourly_wage,
      status: selectedEmployee.status || '',
      hire_date: selectedEmployee.hire_date || '',
      resigned_date: selectedEmployee.resigned_date || '',
      bank_name: selectedEmployee.bank_name || '',
      bank_no: selectedEmployee.bank_no || '',
      role: selectedEmployee.role || '',
      note: selectedEmployee.note || '',
    });
    setIsEditMode(true);
  };

  const handleEditCancel = () => {
    setIsEditMode(false);
  };

  const handleEditFormChange = (field: keyof EditableFields, value: string | number | null) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSave = async () => {
    if (!selectedEmployee) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${selectedEmployee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const result = await res.json();
      if (result.success) {
        // 목록 갱신
        setEmployees((prev) =>
          prev.map((e) => (e.id === selectedEmployee.id ? result.data : e))
        );
        setSelectedEmployee(result.data);
        setIsEditMode(false);
      } else {
        alert(result.error || '저장 중 오류가 발생했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // 추가 모달
  // ============================================================
  const handleAddOpen = () => {
    setAddForm(EMPTY_FORM);
    setIsAddModalOpen(true);
  };

  const handleAddClose = () => {
    setIsAddModalOpen(false);
  };

  const handleAddFormChange = (field: keyof EditableFields, value: string | number | null) => {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddSave = async () => {
    setIsAdding(true);
    try {
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      const result = await res.json();
      if (result.success) {
        setEmployees((prev) => [result.data, ...prev]);
        setIsAddModalOpen(false);
        setAddForm(EMPTY_FORM);
      } else {
        alert(result.error || '추가 중 오류가 발생했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  // ============================================================
  // 필드 렌더링 헬퍼
  // ============================================================
  const formatDate = (date: string | null) => {
    if (!date) return '-';
    return date.split('T')[0]; // YYYY-MM-DD
  };

  /** 생년월일 → "YYYY-MM-DD (만 XX세)" */
  const formatBirthWithAge = (date: string | null) => {
    if (!date) return '-';
    const d = date.split('T')[0];
    const birth = new Date(d);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return `${d} (${age})`;
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (key === 'access_authorization') return value ? '✅ 있음' : '❌ 없음';
    if (key === 'created_at') return formatDate(String(value));
    if (key === 'birth_date' || key === 'hire_date' || key === 'resigned_date') return formatDate(String(value));
    if (key === 'hourly_wage') return `${Number(value).toLocaleString()}원`;
    return String(value);
  };

  // 표시 필드 순서 (모달)
  const DETAIL_FIELDS: (keyof Employee)[] = [
    'name', 'name_kr', 'role', 'status',
    'birth_date', 'phone', 'wechat', 'address',
    'identification', 'hourly_wage',
    'hire_date', 'resigned_date',
    'bank_name', 'bank_no',
    'note', 'access_authorization', 'created_at',
  ];

  // 수정 가능 필드 (access_authorization, code, id, created_at 제외)
  const EDIT_FIELDS: (keyof EditableFields)[] = [
    'name', 'name_kr', 'role', 'status',
    'birth_date', 'phone', 'wechat', 'address',
    'identification', 'hourly_wage',
    'hire_date', 'resigned_date',
    'bank_name', 'bank_no', 'note',
  ];

  // 날짜 타입 필드
  const DATE_FIELDS = new Set(['birth_date', 'hire_date', 'resigned_date']);
  const NUMBER_FIELDS = new Set(['hourly_wage']);
  const SELECT_FIELDS: Record<string, string[]> = {
    status: ['WORKING', 'RESIGNED'],
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
              <h2 className="em-lock-title">직원관리</h2>
              <p className="em-lock-desc">접근 코드 8자리를 입력해주세요</p>
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
                {isVerifying ? '확인 중...' : '확인'}
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
            <h1 className="em-page-title">직원관리</h1>
            <button className="em-add-btn" onClick={handleAddOpen}>
              + 추가
            </button>
          </div>

          {/* ── 검색 ── */}
          <div className="em-search-bar">
            <input
              type="text"
              className="em-search-input"
              placeholder="이름 검색 (영문/한국어)"
              value={searchQuery}
              onChange={handleSearchChange}
            />
          </div>

          {/* ── 테이블 ── */}
          <div className="em-table-wrapper">
            {isLoading ? (
              <div className="em-loading">불러오는 중...</div>
            ) : (
              <table className="em-table">
                <thead>
                  <tr>
                    <th>이름 (영문)</th>
                    <th>이름 (한국어)</th>
                    <th>상태</th>
                    <th>생년월일</th>
                    <th>입사일</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="em-empty">데이터가 없습니다.</td>
                    </tr>
                  ) : (
                    pagedEmployees.map((emp) => (
                      <tr
                        key={emp.id}
                        className="em-table-row"
                        onClick={() => handleRowClick(emp)}
                      >
                        <td>{emp.name || '-'}</td>
                        <td>{emp.name_kr || '-'}</td>
                        <td>
                          <span className={`em-status-badge em-status-${emp.status || 'none'}`}>
                            {emp.status || '-'}
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

      {/* ============================================================
          슬라이드 상세 모달 (오른쪽에서 슬라이드인)
          ============================================================ */}
      {isDetailOpen && selectedEmployee && (
        <>
          <div className="em-overlay" onClick={handleDetailClose} />
          <div className="em-slide-modal open">
            {/* 헤더 */}
            <div className="em-slide-header">
              <h2 className="em-slide-title">
                {selectedEmployee.name || selectedEmployee.name_kr || '직원 상세'}
              </h2>
              <button className="em-slide-close" onClick={handleDetailClose}>✕</button>
            </div>

            {/* 내용 */}
            <div className="em-slide-body">
              {isEditMode ? (
                /* ── 수정 모드 ── */
                <div className="em-edit-form">
                  {EDIT_FIELDS.map((field) => (
                    <div key={field} className="em-form-row">
                      <label className="em-form-label">{FIELD_LABELS[field]}</label>
                      {field === 'note' ? (
                        <textarea
                          className="em-form-textarea"
                          value={(editForm[field] as string) || ''}
                          onChange={(e) => handleEditFormChange(field, e.target.value)}
                          rows={3}
                        />
                      ) : SELECT_FIELDS[field] ? (
                        <select
                          className="em-form-input"
                          value={(editForm[field] as string) || ''}
                          onChange={(e) => handleEditFormChange(field, e.target.value)}
                        >
                          <option value="">선택</option>
                          {SELECT_FIELDS[field].map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={
                            DATE_FIELDS.has(field) ? 'date' :
                            NUMBER_FIELDS.has(field) ? 'number' : 'text'
                          }
                          className="em-form-input"
                          value={
                            NUMBER_FIELDS.has(field)
                              ? (editForm[field] ?? '')
                              : (editForm[field] as string) || ''
                          }
                          onChange={(e) => {
                            const val = NUMBER_FIELDS.has(field)
                              ? (e.target.value === '' ? null : Number(e.target.value))
                              : e.target.value;
                            handleEditFormChange(field, val);
                          }}
                        />
                      )}
                    </div>
                  ))}
                  {/* access_authorization - 읽기 전용 표시 */}
                  <div className="em-form-row">
                    <label className="em-form-label">{FIELD_LABELS['access_authorization']}</label>
                    <span className="em-form-readonly">
                      {selectedEmployee.access_authorization ? '✅ 있음' : '❌ 없음'} (수정 불가)
                    </span>
                  </div>
                </div>
              ) : (
                /* ── 보기 모드 ── */
                <div className="em-detail-view">
                  {DETAIL_FIELDS.map((field) => (
                    <div key={field} className="em-detail-row">
                      <span className="em-detail-label">{FIELD_LABELS[field]}</span>
                      <span className="em-detail-value">
                        {formatValue(field, selectedEmployee[field])}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="em-slide-footer">
              {isEditMode ? (
                <>
                  <button className="em-btn em-btn-cancel" onClick={handleEditCancel}>취소</button>
                  <button
                    className="em-btn em-btn-save"
                    onClick={handleEditSave}
                    disabled={isSaving}
                  >
                    {isSaving ? '저장 중...' : '저장'}
                  </button>
                </>
              ) : (
                <button className="em-btn em-btn-edit" onClick={handleEditStart}>수정</button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ============================================================
          추가 모달 (오버레이 센터)
          ============================================================ */}
      {isAddModalOpen && (
        <div className="em-modal-overlay">
          <div className="em-add-modal">
            <div className="em-add-modal-header">
              <h2>직원 추가</h2>
              <button className="em-slide-close" onClick={handleAddClose}>✕</button>
            </div>
            <div className="em-add-modal-body">
              {EDIT_FIELDS.map((field) => (
                <div key={field} className="em-form-row">
                  <label className="em-form-label">{FIELD_LABELS[field]}</label>
                  {field === 'note' ? (
                    <textarea
                      className="em-form-textarea"
                      value={(addForm[field] as string) || ''}
                      onChange={(e) => handleAddFormChange(field, e.target.value)}
                      rows={3}
                    />
                  ) : SELECT_FIELDS[field] ? (
                    <select
                      className="em-form-input"
                      value={(addForm[field] as string) || ''}
                      onChange={(e) => handleAddFormChange(field, e.target.value)}
                    >
                      <option value="">선택</option>
                      {SELECT_FIELDS[field].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        DATE_FIELDS.has(field) ? 'date' :
                        NUMBER_FIELDS.has(field) ? 'number' : 'text'
                      }
                      className="em-form-input"
                      value={
                        NUMBER_FIELDS.has(field)
                          ? (addForm[field] ?? '')
                          : (addForm[field] as string) || ''
                      }
                      onChange={(e) => {
                        const val = NUMBER_FIELDS.has(field)
                          ? (e.target.value === '' ? null : Number(e.target.value))
                          : e.target.value;
                        handleAddFormChange(field, val);
                      }}
                    />
                  )}
                </div>
              ))}
              {/* access_authorization - 항상 false, 표시만 */}
              <div className="em-form-row">
                <label className="em-form-label">{FIELD_LABELS['access_authorization']}</label>
                <span className="em-form-readonly">❌ 없음 (기본값, 수정 불가)</span>
              </div>
            </div>
            <div className="em-add-modal-footer">
              <button className="em-btn em-btn-cancel" onClick={handleAddClose}>취소</button>
              <button
                className="em-btn em-btn-save"
                onClick={handleAddSave}
                disabled={isAdding}
              >
                {isAdding ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManagement;
