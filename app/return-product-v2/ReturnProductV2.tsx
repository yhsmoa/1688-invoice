'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import ReturnProductV2StatusCard from './ReturnProductV2StatusCard';
import './ReturnProductV2.css';

// ============================================================
// 타입
// ============================================================
interface Worker {
  id: string;
  name: string;
  name_kr: string;
  role: string;
}

// ============================================================
// 상수
// ============================================================

/** DB status → 화면 표시 라벨 */
const STATUS_DISPLAY: Record<string, string> = {
  PENDING:    '접수',
  PROCESSING: '진행',
  DONE:       '완료',
};

/** 상태카드 key → DB status 값 (null = 전체) */
const CARD_TO_STATUS: Record<string, string | null> = {
  all:  null,
  '접수': 'PENDING',
  '진행': 'PROCESSING',
  '완료': 'DONE',
};

const STATUS_CARD_CONFIG = [
  { key: 'all',  label: '전체' },
  { key: '접수', label: '환불접수' },
  { key: '진행', label: '환불진행중' },
  { key: '완료', label: '환불완료' },
];

/** 상태 변경 옵션 (드롭다운) */
const STATUS_OPTIONS = [
  { value: 'PENDING',    label: '접수' },
  { value: 'PROCESSING', label: '진행' },
  { value: 'DONE',       label: '완료' },
];

/** 요청자 옵션 (드롭다운) */
const REQUESTER_OPTIONS = ['유화무역', '고객'];


/** 인라인 편집 가능한 status 집합 (접수·진행 단계만) */
const EDITABLE_STATUSES = new Set(['PENDING', 'PROCESSING']);

/** 서비스료 비율 (6%) */
const SERVICE_FEE_RATE = 0.06;

// ============================================================
// 타입
// ============================================================
interface FtUser {
  id: string;
  full_name: string;
  user_code: string;
  brand: string | null;
  vender_name: string | null;
}

export interface CancelDetail {
  id: string;
  status: string | null;
  order_items_id: string | null;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  qty: number | null;
  total_price_cny: number | null;
  delivery_price_cny: number | null;
  service_fee: number | null;
  cancel_reason: string | null;
  created_at: string;
  user_id: string | null;
  '1688_order_no': string | null;
  requester: string | null;
  fulfillments_id: string | null;
  /** 'CANCEL'(주문취소) | 'RETURN'(반품접수) — API GET에서 NULL → 'CANCEL' fallback 처리됨 */
  cancel_type: string | null;
}

type EditField = 'total_price_cny' | 'delivery_price_cny' | 'service_fee' | 'cancel_reason';

// ============================================================
// 헬퍼
// ============================================================
const formatDate = (iso: string): { date: string; time: string } => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
  };
};

const canEdit = (status: string | null) =>
  status !== null && EDITABLE_STATUSES.has(status);

// ============================================================
// 메인 컴포넌트
// ============================================================
const ReturnProductV2: React.FC = () => {
  const { t } = useTranslation();

  // ── 드롭박스 (Worker / 사업자)
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [users, setUsers] = useState<FtUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  // Worker 목록 로드 (invoiceManager_employees, status=WORKING, role=매니저/검수)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hr/workers');
        const json = await res.json();
        if (json.success) setWorkers(json.data);
      } catch (err) {
        console.error('workers 조회 오류:', err);
      }
    })();
  }, []);

  // ── 데이터
  const [details, setDetails] = useState<CancelDetail[]>([]);
  const [loading, setLoading] = useState(false);

  // ── 필터 / 검색
  const [activeStatus, setActiveStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── 페이지네이션
  const [itemsPerPage, setItemsPerPage] = useState(30);
  const [currentPage, setCurrentPage] = useState(1);

  // ── 체크박스
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // ── 드롭다운 (상태 / 요청자)
  const [statusDropdownId, setStatusDropdownId] = useState<string | null>(null);
  const [requesterDropdownId, setRequesterDropdownId] = useState<string | null>(null);

  // ── 인라인 편집 (가격 / 배송비 / 서비스 / 반품사유)
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditField } | null>(null);
  const [editValue, setEditValue] = useState('');

  // ── 액션 버튼 로딩
  const [actionLoading, setActionLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // ============================================================
  // 드롭다운 외부 클릭 시 닫기
  // ============================================================
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusDropdownId !== null || requesterDropdownId !== null) {
        const target = e.target as Node;
        if (dropdownRef.current && !dropdownRef.current.contains(target)) {
          setStatusDropdownId(null);
          setRequesterDropdownId(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [statusDropdownId, requesterDropdownId]);

  // ============================================================
  // ft_users 조회
  // ============================================================
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch('/api/ft/users');
      const json = await res.json();
      if (json.success) setUsers(json.data);
    } catch (err) {
      console.error('ft_users fetch 오류:', err);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ============================================================
  // ft_cancel_details 조회
  // ============================================================
  const fetchDetails = useCallback(async (userId: string) => {
    setLoading(true);
    setDetails([]);
    setSelectedRows(new Set());
    setSelectAll(false);
    setCurrentPage(1);
    try {
      const res = await fetch(`/api/ft/cancel-details?user_id=${userId}`);
      const json = await res.json();
      if (json.success) setDetails(json.data);
      else console.error('ft_cancel_details 조회 실패:', json.error);
    } catch (err) {
      console.error('ft_cancel_details fetch 오류:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 사용자 선택 → 자동 조회
  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const userId = e.target.value;
      setSelectedUserId(userId);
      setActiveStatus('all');
      setSearchTerm('');
      setSearchInput('');
      if (userId) fetchDetails(userId);
      else setDetails([]);
    },
    [fetchDetails]
  );

  // ============================================================
  // 필드 업데이트 (낙관적 업데이트 + PATCH API)
  // ============================================================
  const updateField = useCallback(
    async (id: string, field: string, value: string | number | null) => {
      // 1) 로컬 상태 즉시 반영 (낙관적 업데이트)
      setDetails((prev) =>
        prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
      );

      // 2) API 저장
      const res = await fetch('/api/ft/cancel-details', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, field, value }),
      });
      const json = await res.json();
      if (!json.success) {
        console.error('ft_cancel_details 업데이트 실패:', json.error);
      }
    },
    []
  );

  // ── 상태 드롭다운 선택
  const handleStatusChange = useCallback(
    (id: string, newStatus: string) => {
      setStatusDropdownId(null);
      updateField(id, 'status', newStatus);
    },
    [updateField]
  );

  // ── 요청자 드롭다운 선택
  const handleRequesterChange = useCallback(
    (id: string, newRequester: string) => {
      setRequesterDropdownId(null);
      updateField(id, 'requester', newRequester);
    },
    [updateField]
  );

  // ── 인라인 편집 시작
  const startEdit = useCallback(
    (id: string, field: EditField, currentValue: number | string | null) => {
      setEditingCell({ id, field });
      setEditValue(currentValue != null ? String(currentValue) : '');
    },
    []
  );

  // ── 인라인 편집 저장 (blur / Enter)
  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    let value: string | number | null;

    if (field === 'cancel_reason') {
      value = editValue.trim() || null;
    } else {
      value = editValue.trim() !== '' ? Number(editValue) : null;
    }

    setEditingCell(null);
    setEditValue('');

    // ── 가격 입력 시 서비스료 자동 계산 (6%) — 순차 처리
    if (field === 'total_price_cny' && typeof value === 'number') {
      const fee = Math.round(value * SERVICE_FEE_RATE * 100) / 100;
      // 로컬 상태를 한번에 반영 (price + fee)
      setDetails((prev) =>
        prev.map((d) => (d.id === id ? { ...d, total_price_cny: value, service_fee: fee } : d))
      );
      // API 순차 저장
      (async () => {
        await fetch('/api/ft/cancel-details', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, field: 'total_price_cny', value }),
        });
        await fetch('/api/ft/cancel-details', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, field: 'service_fee', value: fee }),
        });
      })();
    } else {
      updateField(id, field, value);
    }
  }, [editingCell, editValue, updateField]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && editingCell?.field !== 'cancel_reason') {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === 'Escape') {
        setEditingCell(null);
        setEditValue('');
      }
    },
    [editingCell, commitEdit]
  );

  // ============================================================
  // 클라이언트 필터링 (상태카드 + 검색)
  // ============================================================
  const filteredDetails = useMemo(() => {
    let list = details;

    // 상태카드 필터
    const dbStatus = CARD_TO_STATUS[activeStatus];
    if (dbStatus) list = list.filter((d) => d.status === dbStatus);

    // 검색 필터 (item_no, 1688_order_no, item_name, option_name, cancel_reason)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((d) =>
        [d.item_no, d['1688_order_no'], d.item_name, d.option_name, d.cancel_reason]
          .some((v) => v?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [details, activeStatus, searchTerm]);

  // ── 상태카드 카운트 (전체 details 기준)
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: details.length };
    details.forEach((d) => {
      const entry = Object.entries(CARD_TO_STATUS).find(([, v]) => v === d.status);
      if (entry) counts[entry[0]] = (counts[entry[0]] ?? 0) + 1;
    });
    return counts;
  }, [details]);

  // ============================================================
  // 페이지네이션
  // ============================================================
  const totalPages = Math.max(1, Math.ceil(filteredDetails.length / itemsPerPage));
  const paginatedDetails = filteredDetails.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // 필터/검색 변경 시 1페이지로
  useEffect(() => { setCurrentPage(1); }, [filteredDetails.length, itemsPerPage]);

  // ============================================================
  // 체크박스
  // ============================================================
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedRows(new Set());
      setSelectAll(false);
    } else {
      setSelectedRows(new Set(paginatedDetails.map((d) => d.id)));
      setSelectAll(true);
    }
  };

  const handleRowCheck = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      // selectAll 동기화: 현재 페이지 전체가 선택되었는지 확인
      setSelectAll(paginatedDetails.length > 0 && paginatedDetails.every((d) => next.has(d.id)));
      return next;
    });
  };

  // ============================================================
  // 검색 실행
  // ============================================================
  const handleSearch = () => {
    setSearchTerm(searchInput);
    setCurrentPage(1);
  };

  // ============================================================
  // 액션 버튼: [진행] — PENDING → PROCESSING
  // ============================================================
  const handleBulkProgress = useCallback(async () => {
    const targets = details.filter(
      (d) => selectedRows.has(d.id) && d.status === 'PENDING'
    );
    if (targets.length === 0) {
      alert('진행할 접수 상태 항목이 없습니다.');
      return;
    }

    setActionLoading(true);
    for (const t of targets) {
      await updateField(t.id, 'status', 'PROCESSING');
    }
    setSelectedRows(new Set());
    setSelectAll(false);
    setActionLoading(false);
  }, [details, selectedRows, updateField]);

  // ============================================================
  // 액션 버튼: [완료] — PROCESSING → DONE (필수 필드 검증)
  // ============================================================
  const handleBulkComplete = useCallback(async () => {
    const targets = details.filter(
      (d) => selectedRows.has(d.id) && d.status === 'PROCESSING'
    );
    if (targets.length === 0) {
      alert('완료할 진행 상태 항목이 없습니다.');
      return;
    }

    // ── 필수 필드 검증 (가격, 배송비, 서비스, 반품사유)
    const missing: string[] = [];
    for (const t of targets) {
      const fields: string[] = [];
      if (t.total_price_cny == null) fields.push('가격');
      if (t.delivery_price_cny == null) fields.push('배송비');
      if (t.service_fee == null) fields.push('서비스');
      if (!t.cancel_reason) fields.push('반품사유');
      if (fields.length > 0) {
        missing.push(`${t.item_no ?? t.id}: ${fields.join(', ')}`);
      }
    }
    if (missing.length > 0) {
      alert(`다음 항목의 필수 정보가 비어있습니다:\n\n${missing.join('\n')}`);
      return;
    }

    setActionLoading(true);
    for (const t of targets) {
      await updateField(t.id, 'status', 'DONE');
    }
    setSelectedRows(new Set());
    setSelectAll(false);
    setActionLoading(false);
  }, [details, selectedRows, updateField]);

  // ============================================================
  // 액션 버튼: [철회] — ft_fulfillments DELETE (cascade)
  // ============================================================
  const handleBulkWithdraw = useCallback(async () => {
    const targets = details.filter((d) => selectedRows.has(d.id));
    if (targets.length === 0) {
      alert('철회할 항목을 선택하세요.');
      return;
    }

    // fulfillments_id 없는 항목 확인
    const noFfId = targets.filter((t) => !t.fulfillments_id);
    if (noFfId.length > 0) {
      alert(`철회 불가: fulfillments 연결 정보가 없는 항목이 ${noFfId.length}건 있습니다.`);
      return;
    }

    if (!confirm(`선택한 ${targets.length}건을 철회하시겠습니까?\n(ft_fulfillments + ft_cancel_details 모두 삭제됩니다)`)) {
      return;
    }

    setActionLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const t of targets) {
      try {
        const res = await fetch(`/api/ft/fulfillments?id=${t.fulfillments_id}`, {
          method: 'DELETE',
        });
        const result = await res.json();
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.error(`철회 실패 (${t.item_no}):`, result.error);
        }
      } catch (err) {
        failCount++;
        console.error(`철회 오류 (${t.item_no}):`, err);
      }
    }

    // 결과 알림 및 새로고침
    if (failCount > 0) {
      alert(`철회 완료: ${successCount}건 성공, ${failCount}건 실패`);
    }

    setSelectedRows(new Set());
    setSelectAll(false);
    setActionLoading(false);

    // 데이터 새로고침
    if (selectedUserId) fetchDetails(selectedUserId);
  }, [details, selectedRows, selectedUserId, fetchDetails]);

  // ============================================================
  // 렌더 헬퍼
  // ============================================================

  /** 상태 배지 CSS 클래스 — DB status 값을 className으로 직접 사용 */
  const statusBadgeClass = (status: string | null) =>
    `return-v2-status-badge ${status ?? ''}`.trim();

  /** 현재 상태카드에 따른 액션 버튼 라벨/핸들러 */
  const actionButton = useMemo(() => {
    if (activeStatus === '접수') {
      return { label: '진행', handler: handleBulkProgress };
    }
    if (activeStatus === '진행') {
      return { label: '완료', handler: handleBulkComplete };
    }
    return null;
  }, [activeStatus, handleBulkProgress, handleBulkComplete]);

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="return-v2-layout">
      <TopsideMenu />
      <div className="return-v2-main-content">
        <LeftsideMenu />
        <main className="return-v2-content">
          <div className="return-v2-container">

            {/* ── 타이틀 행 ── */}
            <div className="return-v2-title-row">
              <h1 className="return-v2-title">반품접수 V2</h1>
              <div className="return-v2-title-controls">
                {/* Worker 선택 (invoiceManager_employees) */}
                <select
                  className="return-v2-user-dropdown"
                  value={selectedWorker}
                  onChange={(e) => setSelectedWorker(e.target.value)}
                >
                  <option value="">Worker</option>
                  {workers.map((w) => (
                    <option key={w.id} value={`${w.name} ${w.name_kr}`}>
                      {w.name} {w.name_kr}
                    </option>
                  ))}
                </select>
                <select
                  className="return-v2-user-dropdown"
                  value={selectedUserId}
                  onChange={handleUserChange}
                  disabled={usersLoading}
                >
                  <option value="">사용자 선택</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.vender_name || user.full_name} {user.user_code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── 상태 카드 ── */}
            <div className="return-v2-status-cards">
              {STATUS_CARD_CONFIG.map((card) => (
                <ReturnProductV2StatusCard
                  key={card.key}
                  label={card.label}
                  count={statusCounts[card.key] ?? 0}
                  isActive={activeStatus === card.key}
                  onClick={() => { setActiveStatus(card.key); setCurrentPage(1); }}
                />
              ))}
            </div>

            {/* ── 검색 ── */}
            <div className="return-v2-search-section">
              <div className="return-v2-search-board">
                <div className="return-v2-search-form-container">
                  <input
                    type="text"
                    className="return-v2-search-input"
                    placeholder="주문번호, 상품명, 반품사유를 입력하세요"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                  />
                  <button className="return-v2-search-button" onClick={handleSearch}>
                    {t('importProduct.search')}
                  </button>
                </div>
              </div>
            </div>

            {/* ── 테이블 액션 바 (검색 아래, 테이블 위) ── */}
            <div className="return-v2-table-actions">
              {/* 왼쪽: 30개보기 드롭다운 */}
              <select
                className="return-v2-items-per-page"
                value={itemsPerPage}
                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              >
                <option value={30}>30개씩 보기</option>
                <option value={50}>50개씩 보기</option>
                <option value={100}>100개씩 보기</option>
              </select>

              {/* 오른쪽: 액션 버튼 */}
              <div className="return-v2-table-actions-right">
                {/* 상태별 진행/완료 버튼 */}
                {actionButton && (
                  <button
                    className="return-v2-action-btn"
                    disabled={selectedRows.size === 0 || actionLoading}
                    onClick={actionButton.handler}
                  >
                    {actionLoading ? (
                      <span className="return-v2-button-loading">
                        <span className="return-v2-spinner" />
                        처리중
                      </span>
                    ) : (
                      actionButton.label
                    )}
                  </button>
                )}

                {/* 철회 버튼 (모든 상태에서 표시) */}
                <button
                  className="return-v2-cancel-btn"
                  disabled={selectedRows.size === 0 || actionLoading}
                  onClick={handleBulkWithdraw}
                >
                  철회
                </button>
              </div>
            </div>

            {/* ── 테이블 ── */}
            <div className="return-v2-table-board" ref={dropdownRef}>
              {loading ? (
                <div className="return-v2-empty-data">{t('importProduct.table.loading')}</div>
              ) : (
                <table className="return-v2-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={handleSelectAll}
                          className="return-v2-table-checkbox"
                        />
                      </th>
                      <th>유형</th>
                      <th>주문번호</th>
                      <th>상품명</th>
                      <th>수량</th>
                      <th>가격</th>
                      <th>배송비</th>
                      <th>서비스</th>
                      <th>요청</th>
                      <th>반품사유</th>
                      <th>상태</th>
                      <th>날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDetails.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="return-v2-empty-data">
                          {selectedUserId ? t('importProduct.table.noData') : '사용자를 선택하세요.'}
                        </td>
                      </tr>
                    ) : (
                      paginatedDetails.map((detail) => {
                        const { date, time } = formatDate(detail.created_at);
                        const displayStatus = STATUS_DISPLAY[detail.status ?? ''] ?? detail.status ?? '-';
                        const editable = canEdit(detail.status);

                        return (
                          <tr
                            key={detail.id}
                            className={selectedRows.has(detail.id) ? 'selected' : ''}
                          >
                            {/* col 1: 체크박스 */}
                            <td>
                              <input
                                type="checkbox"
                                className="return-v2-table-checkbox"
                                checked={selectedRows.has(detail.id)}
                                onChange={() => handleRowCheck(detail.id)}
                              />
                            </td>

                            {/* col 2: 유형 (CANCEL / RETURN) */}
                            <td style={{ textAlign: 'center', fontSize: 12 }}>
                              {detail.cancel_type ?? 'CANCEL'}
                            </td>

                            {/* col 3: 주문번호 (item_no + 1688_order_no 2행) */}
                            <td>
                              <div className="return-v2-two-line-cell">
                                <span className="return-v2-order-number-text">
                                  {detail.item_no || '-'}
                                </span>
                                {detail['1688_order_no'] && (
                                  <span className="return-v2-1688-order-number">
                                    {detail['1688_order_no']}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* col 3: 상품명 + 옵션 (동일 폰트 크기/색상) */}
                            <td>
                              <span className="return-v2-product-name">
                                {detail.item_name || '-'}
                                {detail.option_name ? `, ${detail.option_name}` : ''}
                              </span>
                            </td>

                            {/* col 4: 수량 */}
                            <td style={{ textAlign: 'center' }}>
                              {detail.qty ?? '-'}
                            </td>

                            {/* ── 인라인 편집 셀 (가격 / 배송비 / 서비스) ── */}

                            {/* col 5: 가격 */}
                            <td
                              style={{ textAlign: 'center' }}
                              className={editable ? 'return-v2-editable-cell' : ''}
                              onClick={() => editable && startEdit(detail.id, 'total_price_cny', detail.total_price_cny)}
                            >
                              {editingCell?.id === detail.id && editingCell.field === 'total_price_cny' ? (
                                <input
                                  className="return-v2-inline-input"
                                  type="number"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={handleEditKeyDown}
                                  autoFocus
                                />
                              ) : (
                                detail.total_price_cny != null ? detail.total_price_cny : '-'
                              )}
                            </td>

                            {/* col 6: 배송비 */}
                            <td
                              style={{ textAlign: 'center' }}
                              className={editable ? 'return-v2-editable-cell' : ''}
                              onClick={() => editable && startEdit(detail.id, 'delivery_price_cny', detail.delivery_price_cny)}
                            >
                              {editingCell?.id === detail.id && editingCell.field === 'delivery_price_cny' ? (
                                <input
                                  className="return-v2-inline-input"
                                  type="number"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={handleEditKeyDown}
                                  autoFocus
                                />
                              ) : (
                                detail.delivery_price_cny != null ? detail.delivery_price_cny : '-'
                              )}
                            </td>

                            {/* col 7: 서비스 (가격 입력 시 자동 계산됨) */}
                            <td
                              style={{ textAlign: 'center' }}
                              className={editable ? 'return-v2-editable-cell' : ''}
                              onClick={() => editable && startEdit(detail.id, 'service_fee', detail.service_fee)}
                            >
                              {editingCell?.id === detail.id && editingCell.field === 'service_fee' ? (
                                <input
                                  className="return-v2-inline-input"
                                  type="number"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={handleEditKeyDown}
                                  autoFocus
                                />
                              ) : (
                                detail.service_fee != null ? detail.service_fee : '-'
                              )}
                            </td>

                            {/* col 8: 요청 (requester) — 클릭 시 드롭다운 */}
                            <td style={{ textAlign: 'center', position: 'relative' }}>
                              <span
                                className="return-v2-clickable-cell"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setStatusDropdownId(null);
                                  setRequesterDropdownId(
                                    requesterDropdownId === detail.id ? null : detail.id
                                  );
                                }}
                              >
                                {detail.requester || '-'}
                              </span>
                              {requesterDropdownId === detail.id && (
                                <div className="return-v2-mini-dropdown" onClick={(e) => e.stopPropagation()}>
                                  {REQUESTER_OPTIONS.map((opt) => (
                                    <div
                                      key={opt}
                                      className={`return-v2-dropdown-option ${detail.requester === opt ? 'active' : ''}`}
                                      onClick={() => handleRequesterChange(detail.id, opt)}
                                    >
                                      {opt}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>

                            {/* col 9: 반품사유 — 인라인 편집 */}
                            <td
                              className={editable ? 'return-v2-editable-cell' : ''}
                              onClick={() => editable && startEdit(detail.id, 'cancel_reason', detail.cancel_reason)}
                            >
                              {editingCell?.id === detail.id && editingCell.field === 'cancel_reason' ? (
                                <textarea
                                  className="return-v2-inline-textarea"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitEdit}
                                  onKeyDown={handleEditKeyDown}
                                  autoFocus
                                  rows={2}
                                />
                              ) : (
                                detail.cancel_reason || '-'
                              )}
                            </td>

                            {/* col 10: 상태 — 클릭 시 드롭다운 */}
                            <td style={{ textAlign: 'center', position: 'relative' }}>
                              <span
                                className={`${statusBadgeClass(detail.status)} return-v2-clickable-cell`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRequesterDropdownId(null);
                                  setStatusDropdownId(
                                    statusDropdownId === detail.id ? null : detail.id
                                  );
                                }}
                              >
                                {displayStatus}
                              </span>
                              {statusDropdownId === detail.id && (
                                <div className="return-v2-mini-dropdown" onClick={(e) => e.stopPropagation()}>
                                  {STATUS_OPTIONS.map((opt) => (
                                    <div
                                      key={opt.value}
                                      className={`return-v2-dropdown-option ${detail.status === opt.value ? 'active' : ''}`}
                                      onClick={() => handleStatusChange(detail.id, opt.value)}
                                    >
                                      {opt.label}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>

                            {/* col 11: 날짜 (2행) */}
                            <td>
                              <div className="return-v2-two-line-cell">
                                <span>{date}</span>
                                <span className="return-v2-1688-order-number">{time}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── 페이지네이션 ── */}
            <div className="return-v2-pagination">
              <button
                className="return-v2-pagination-button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                {t('importProduct.pagination.previous')}
              </button>
              <div className="return-v2-page-numbers">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => Math.abs(page - currentPage) <= 2)
                  .map((page) => (
                    <button
                      key={page}
                      className={`return-v2-page-number ${page === currentPage ? 'active' : ''}`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
              </div>
              <button
                className="return-v2-pagination-button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('importProduct.pagination.next')}
              </button>
              <span className="return-v2-page-info">
                {currentPage} / {totalPages} {t('importProduct.pagination.page')} (
                {t('importProduct.pagination.total')} {filteredDetails.length}개)
              </span>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

export default ReturnProductV2;
