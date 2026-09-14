'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import './PaymentHistory.css';

// ============================================================
// 고객계좌 (구) — 구 원장 invoiceManager_transactions **조회 전용**
//
//   2026-09-14 부터 충전·차감·1688 주문 차감·날짜 수정은 이 화면에서 하지 않는다.
//   신 원장(ft_user_transactions)이 유일한 기준이 되었으므로, 기록은 전부
//   고객계좌 (신) (/invoice/payment-history-v2) 에서 한다. 여기서 구 원장에 기록하면
//   신 원장 잔액에 반영되지 않아 두 장부가 어긋난다.
//
//   남은 기능: 사용자 선택 → 업데이트(잔액·거래 조회), 기간·검색어 필터, 엑셀 다운로드.
// ============================================================

// 데이터 타입 정의 - invoiceManager_transactions 테이블
export interface PaymentHistoryData {
  id: string;
  order_code: string | null;
  user_id: string | null;
  transaction_type: string | null;
  description: string | null;
  admin_note: string | null;
  item_qty: number | null;
  amount: number | null;
  price: number | null;
  delivery_fee: number | null;
  service_fee: number | null;
  extra_fee: number | null;
  balance_after: number | null;
  status: string | null;
  date: string | null;  // YYYY-MM-DD 형식
  created_at: string | null;
  updated_at: string | null;
  delivery_status?: string | null;
  site_url?: string | null;
  /** 표시용 — user_id(UUID) 대신 사람이 읽는 값 */
  user_name?: string | null;
  user_code?: string | null;
}

// ============================================================
// 표시용 행 (참조 페이지 transactions 와 동일 구조)
//   · 차감 → 지출/배송/서비스/기타/총비용 음수
//   · 충전 → 충전 열
//   · balance → 전체 이력 기준 누적 (통장식)
// ============================================================
interface DisplayTx extends PaymentHistoryData {
  expense: number | null;
  delivery: number | null;
  service: number | null;
  extra: number | null;
  total: number | null;
  charge: number | null;
  refund: number | null;
  balance: number;
}

// 숫자 포맷 (빈값은 공백, -0 → 0)
const fmtTx = (n: number | null): string => {
  if (n == null) return '';
  const v = n === 0 ? 0 : n;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/** 드롭다운 항목 — /api/ft/users 응답 */
interface FtUserOption {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
  username: string | null;
  /** 계좌 그룹 (UUID) — 잔액·거래 집계 기준 */
  master_id: string | null;
  /** 구 방식 계좌명 — 하위호환용 */
  master_account: string | null;
}

/**
 * 표 '사업자' 열 표시값.
 *   user_code 우선(BZ/BO/HI/MB) → user_name(immong) → 그래도 없으면 '-'.
 *   user_id 는 UUID 라 화면에 그대로 노출하지 않는다.
 */
const userDisplay = (row: PaymentHistoryData): string =>
  row.user_code || row.user_name || '-';

/** 드롭다운 표시명 — "아이엠몽 BZ" (같은 업체 여러 계정 구분) */
const userLabel = (u: FtUserOption): string =>
  [u.vender_name || u.full_name || u.username, u.user_code].filter(Boolean).join(' ');

interface PaymentHistoryProps {
  /** 페이지 타이틀 — 고객계좌 / 무역계좌 공용 */
  title?: string;
}

const PaymentHistory: React.FC<PaymentHistoryProps> = ({ title = '고객계좌' }) => {
  const { t } = useTranslation();

  // State 관리
  const [itemData, setItemData] = useState<PaymentHistoryData[]>([]);
  const [loading, setLoading] = useState(false);
  // ft_users 기준 — 선택 키는 id(UUID), 표시는 "업체명 + 코드"
  const [ftUsers, setFtUsers] = useState<FtUserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  // 계좌 결제조건 — POSTPAID(후불)면 '잔액' 대신 '미정산액'으로 표기
  const [paymentType, setPaymentType] = useState<'PREPAID' | 'POSTPAID'>('PREPAID');

  // 검색 필터 상태 — 월 단위 기간 (몇년몇월 ~ 몇년몇월, 기본 = 당월~당월)
  const [startYear, setStartYear] = useState<string>(() => String(new Date().getFullYear()));
  const [startMonth, setStartMonth] = useState<string>(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [endYear, setEndYear] = useState<string>(() => String(new Date().getFullYear()));
  const [endMonth, setEndMonth] = useState<string>(() => String(new Date().getMonth() + 1).padStart(2, '0'));

  const itemsPerPage = 20;

  // ============================================================
  // 조회
  // ============================================================

  // 사용자 목록 (ft_users)
  const fetchFtUsers = async () => {
    try {
      const response = await fetch('/api/ft/users');
      const result = await response.json();

      if (result.success && result.data) {
        setFtUsers(result.data as FtUserOption[]);
      } else {
        console.warn('사용자 목록을 가져오지 못했습니다:', result);
      }
    } catch (error) {
      console.error('사용자 목록 조회 오류:', error);
    }
  };

  useEffect(() => {
    fetchFtUsers();
  }, []);

  // 드롭다운 선택 시 상태 초기화
  useEffect(() => {
    if (!selectedUserId) {
      setHasLoadedData(false);
      setItemData([]);
      setBalance(null);
    }
  }, [selectedUserId]);

  // 잔액 조회 — 트랜잭션(Σ충전−Σ차감) + 완료환불(ft_cancel_details DONE)
  const fetchBalance = async (masterId: string) => {
    try {
      const response = await fetch(`/api/get-customer-balance?master_id=${encodeURIComponent(masterId)}`);
      const result = await response.json();

      if (result.success) {
        setBalance(result.balance);
        setPaymentType(result.paymentType === 'POSTPAID' ? 'POSTPAID' : 'PREPAID');
      } else {
        console.warn('잔액 조회 실패:', result.error);
        setBalance(null);
      }
    } catch (error) {
      console.error('잔액 조회 오류:', error);
      setBalance(null);
    }
  };

  // 트랜잭션 데이터 조회
  const fetchTransactions = async (userId: string) => {
    try {
      // 누적 잔액(통장식) 계산을 위해 전체 이력 로드 — 월 필터는 표시 단계(displayRows)에서 적용
      const response = await fetch(`/api/get-payment-transactions?user_id=${encodeURIComponent(userId)}`);
      const result = await response.json();

      if (result.success) {
        setItemData(result.data);
      } else {
        console.error('트랜잭션 조회 실패:', result.error);
      }
    } catch (error) {
      console.error('트랜잭션 조회 오류:', error);
    }
  };

  // 업데이트 버튼 - 잔액 + 트랜잭션 조회
  const handleUpdate = async () => {
    if (!selectedUserId) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = ftUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser) {
      alert('선택한 사용자 정보를 찾을 수 없습니다.');
      return;
    }

    try {
      setLoading(true);

      if (selectedUser.master_id) {
        await fetchBalance(selectedUser.master_id);
      }

      await fetchTransactions(selectedUser.id);
      setHasLoadedData(true);

      setLoading(false);
    } catch (error) {
      console.error('업데이트 오류:', error);
      alert(`업데이트 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      setLoading(false);
    }
  };

  // 검색 기능 - 전체 이력 재조회 (월/검색어 필터는 displayRows 에서 처리)
  const handleSearchClick = async () => {
    if (!selectedUserId) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }

    const selectedUser = ftUsers.find((u) => u.id === selectedUserId);
    if (!selectedUser || !selectedUser.id) return;

    setLoading(true);
    try {
      await fetchTransactions(selectedUser.id);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchClick();
    }
  };

  // ============================================================
  // 표시 행 — 전체 이력 누적잔액 계산 후 선택 월 + 검색어 필터
  //   · 정렬: date ASC, created_at ASC (오래된 순)
  //   · 차감 → 음수, 충전 → 충전열, 누적은 전체 기준
  // ============================================================
  const displayRows = useMemo<DisplayTx[]>(() => {
    // 기간 범위 (YYYY-MM-01 ~ 종료월 말일) — 문자열 비교 (date='YYYY-MM-DD')
    const startKey = `${startYear}-${startMonth}-01`;
    const endLast = new Date(Number(endYear), Number(endMonth), 0).getDate();
    const endKey = `${endYear}-${endMonth}-${String(endLast).padStart(2, '0')}`;
    const term = searchTerm.trim().toLowerCase();

    const sorted = [...itemData].sort((a, b) => {
      const d = (a.date ?? '').localeCompare(b.date ?? '');
      if (d !== 0) return d;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });

    let cumulative = 0;
    const out: DisplayTx[] = [];
    for (const r of sorted) {
      const amt = r.amount ?? 0;
      let expense: number | null = null;
      let delivery: number | null = null;
      let service: number | null = null;
      let extra: number | null = null;
      let total: number | null = null;
      let charge: number | null = null;

      if (r.transaction_type === '차감') {
        expense = -(r.price ?? 0);
        delivery = -(r.delivery_fee ?? 0);
        service = -(r.service_fee ?? 0);
        extra = -(r.extra_fee ?? 0);
        total = -amt;
        cumulative += -amt;
      } else if (r.transaction_type === '충전') {
        charge = amt;
        cumulative += amt;
      }

      // 누적은 전체 기준으로 진행, 표시는 선택 기간 + 검색어만
      if (!(r.date && r.date >= startKey && r.date <= endKey)) continue;
      if (term) {
        const hay = `${r.description ?? ''} ${r.transaction_type ?? ''} ${r.user_id ?? ''} ${r.admin_note ?? ''}`.toLowerCase();
        if (!hay.includes(term)) continue;
      }
      out.push({ ...r, expense, delivery, service, extra, total, charge, refund: null, balance: cumulative });
    }
    return out;
  }, [itemData, startYear, startMonth, endYear, endMonth, searchTerm]);

  // 필터 변경 시 첫 페이지로
  useEffect(() => {
    setCurrentPage(1);
  }, [startYear, startMonth, endYear, endMonth, searchTerm]);

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(displayRows.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = displayRows.slice(startIndex, endIndex);

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handlePageChange = (pageNum: number) => {
    setCurrentPage(pageNum);
  };

  // ============================================================
  // 엑셀 다운로드
  // ============================================================
  const handleExcelDownload = async () => {
    if (displayRows.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    try {
      const XLSX = await import('xlsx');

      // 금액 표시 헬퍼 함수 (차감일 경우 마이너스 표시)
      const formatAmountForExcel = (amount: number | null, transactionType: string | null): number | string => {
        if (amount === null || amount === undefined) return '';
        return transactionType === '차감' ? -amount : amount;
      };

      // 테이블 컬럼 순서대로 데이터 변환
      const excelData = displayRows.map((item) => ({
        '업체': userDisplay(item),
        '주문코드': item.order_code || '',
        '타입': item.transaction_type || '',
        '내용': item.description || '',
        '수량': item.item_qty ?? '',
        '총금액': formatAmountForExcel(item.amount, item.transaction_type),
        '금액': formatAmountForExcel(item.price, item.transaction_type),
        '배송비': formatAmountForExcel(item.delivery_fee, item.transaction_type),
        '서비스비': formatAmountForExcel(item.service_fee, item.transaction_type),
        '기타비용': formatAmountForExcel(item.extra_fee, item.transaction_type),
        '잔액': item.balance_after ?? '',
        '상태': item.status || '',
        '관리자비고': item.admin_note || '',
        '날짜': item.date || '',
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '결제내역');

      // 파일명: {타이틀}_업체명_시작월~종료월.xlsx
      const dateRange = `${startYear}${startMonth}~${endYear}${endMonth}`;
      const selectedUser = ftUsers.find((u) => u.id === selectedUserId);
      const who = selectedUser ? userLabel(selectedUser) : '';
      const fileName = `${title}_${who}_${dateRange}.xlsx`;
      XLSX.writeFile(workbook, fileName);

    } catch (error) {
      console.error('엑셀 다운로드 오류:', error);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="payment-history-layout">
      <TopsideMenu />
      <div className="payment-history-main-content">
        <LeftsideMenu />
        <main className="payment-history-content">
          <div className="payment-history-container">
            {/* 타이틀 행 - 왼쪽: 제목, 오른쪽: 사용자 선택 및 업데이트 */}
            <div className="payment-history-title-row">
              <h1 className="payment-history-title">{title}</h1>
              <div className="payment-history-title-controls">
                <select
                  className="payment-history-user-dropdown"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">{t('importProduct.selectUser')}</option>
                  {/* value 는 id(UUID) — 업체명이 겹쳐도(아이엠몽 BZ/BR) 정확히 구분된다 */}
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {userLabel(user)}
                    </option>
                  ))}
                </select>
                <button
                  className="payment-history-upload-btn"
                  onClick={handleUpdate}
                  disabled={!selectedUserId || loading}
                >
                  {loading ? (
                    <span className="payment-history-button-loading">
                      <span className="payment-history-spinner"></span>
                      {t('importProduct.refresh')}
                    </span>
                  ) : (
                    t('importProduct.refresh')
                  )}
                </button>
                <button
                  className="payment-history-download-btn"
                  onClick={handleExcelDownload}
                  disabled={displayRows.length === 0}
                >
                  엑셀 다운로드
                </button>
              </div>
            </div>

            {/* 조회 전용 안내 — 기록은 고객계좌 (신) */}
            <div className="payment-history-readonly-banner">
              구 원장 조회 전용입니다. 충전·차감·1688 주문 차감·적용일 수정은{' '}
              <Link href="/invoice/payment-history-v2">고객계좌 (신)</Link>에서 진행하세요.
            </div>

            {/* 기간 (잔액 보드 위, 보드 밖 좌측) — 몇년몇월 ~ 몇년몇월 */}
            <div className="payment-history-period-row">
              <select className="payment-history-period-select" value={startYear} onChange={(e) => setStartYear(e.target.value)}>
                {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() + 1 - i)).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select className="payment-history-period-select" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>{parseInt(m, 10)}월</option>
                ))}
              </select>
              <span className="payment-history-period-tilde">~</span>
              <select className="payment-history-period-select" value={endYear} onChange={(e) => setEndYear(e.target.value)}>
                {Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() + 1 - i)).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              <select className="payment-history-period-select" value={endMonth} onChange={(e) => setEndMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>{parseInt(m, 10)}월</option>
                ))}
              </select>

              {/* 잔액 — 기간 반대편(오른쪽), 보드 없음 */}
              <div className="payment-history-balance-inline">
                <span className="payment-history-balance-label">
                  {paymentType === 'POSTPAID' ? '미정산액:' : '잔액:'}
                </span>
                <span
                  className={`payment-history-balance-value ${
                    paymentType === 'POSTPAID' ? 'is-unsettled' : ''
                  }`}
                >
                  {/* 후불은 차감 누적이라 음수가 정상 → 절대값으로 표기 */}
                  {balance !== null
                    ? (paymentType === 'POSTPAID' ? Math.abs(balance) : balance).toLocaleString()
                    : '-'}
                </span>
              </div>
            </div>

            {/* 검색 영역 — 알약형 검색 입력 */}
            <div className="payment-history-search-section">
              <div className="payment-history-search-pill">
                <svg className="payment-history-search-pill-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
                </svg>
                <input
                  type="text"
                  className="payment-history-search-pill-input"
                  placeholder="주문번호, 상품명, 고객명으로 검색"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={handleSearchKeyPress}
                />
              </div>
            </div>

            {/* 테이블 */}
            <div className="payment-history-table-board">
              {loading ? (
                <div className="payment-history-empty-data">{t('importProduct.table.loading')}</div>
              ) : (
                <table className="payment-history-table">
                  <thead>
                    <tr>
                      <th className="txn-th txn-th-left">생성일</th>
                      <th className="txn-th txn-th-left">사업자</th>
                      <th className="txn-th txn-th-center">타입</th>
                      <th className="txn-th txn-th-left">내용</th>
                      <th className="txn-th txn-th-center">수량</th>
                      <th className="txn-th txn-th-right">지출금액</th>
                      <th className="txn-th txn-th-right">배송비</th>
                      <th className="txn-th txn-th-right">서비스비</th>
                      <th className="txn-th txn-th-right">기타비용</th>
                      <th className="txn-th txn-th-right">총비용</th>
                      <th className="txn-th txn-th-right">충전</th>
                      <th className="txn-th txn-th-right">환불</th>
                      <th className="txn-th txn-th-right">잔액</th>
                      <th className="txn-th txn-th-center">상태</th>
                      <th className="txn-th txn-th-left">관리자비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedData.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="payment-history-empty-data">
                          {t('importProduct.table.noData')}
                        </td>
                      </tr>
                    ) : (
                      paginatedData.map((row) => {
                        const rowClass =
                          row.transaction_type === '충전' ? 'txn-row-charge'
                          : row.transaction_type === '차감' ? 'txn-row-deduct'
                          : '';
                        return (
                          <tr key={row.id} className={rowClass}>
                            {/* 생성일 — 조회 전용 (날짜 수정은 고객계좌 (신)) */}
                            <td className="txn-td txn-td-left">{row.date || '-'}</td>
                            {/* 사업자 — user_id 는 UUID 이므로 코드/이름으로 표시 */}
                            <td className="txn-td txn-td-left">{userDisplay(row)}</td>
                            <td className="txn-td txn-td-center">{row.transaction_type || '-'}</td>
                            <td className="txn-td txn-td-left txn-td-desc" title={row.description ?? ''}>{row.description || '-'}</td>
                            <td className="txn-td txn-td-center">{row.item_qty ?? ''}</td>
                            <td className="txn-td txn-td-right">{fmtTx(row.expense)}</td>
                            <td className="txn-td txn-td-right">{fmtTx(row.delivery)}</td>
                            <td className="txn-td txn-td-right">{fmtTx(row.service)}</td>
                            <td className="txn-td txn-td-right">{fmtTx(row.extra)}</td>
                            <td className="txn-td txn-td-right txn-td-total">{fmtTx(row.total)}</td>
                            <td className="txn-td txn-td-right txn-td-charge">{fmtTx(row.charge)}</td>
                            <td className="txn-td txn-td-right">{fmtTx(row.refund)}</td>
                            <td className="txn-td txn-td-right txn-td-balance">{fmtTx(row.balance)}</td>
                            <td className="txn-td txn-td-center">{row.status || '-'}</td>
                            <td className="txn-td txn-td-left txn-td-note">{row.admin_note || '-'}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* 페이지네이션 */}
            {!loading && displayRows.length > 0 && (
              <div className="payment-history-pagination">
                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1}
                  className="payment-history-pagination-button"
                >
                  {t('importProduct.pagination.previous')}
                </button>

                <div className="payment-history-page-numbers">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`payment-history-page-number ${currentPage === pageNum ? 'active' : ''}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className="payment-history-pagination-button"
                >
                  {t('importProduct.pagination.next')}
                </button>

                <span className="payment-history-page-info">
                  {currentPage} / {totalPages} {t('importProduct.pagination.page')} ({t('importProduct.pagination.total')} {displayRows.length}개)
                </span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default PaymentHistory;
