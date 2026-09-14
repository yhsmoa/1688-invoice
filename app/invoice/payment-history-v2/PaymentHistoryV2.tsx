'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import type { UserTxDisplayRow, LedgerWriteResult } from '../../../lib/userTransactions';
import { fetchTodayRate } from '../../../lib/exchangeRate';
import './PaymentHistoryV2.css';

// ============================================================
// 고객계좌 (신) — 신 원장 ft_user_transactions (2026-09-13 부터 유일한 기준)
//
// 참조: purchase-agent /transactions/v2 (거래내역 (신)) 의 관리자용 화면.
//
//   · 잔액 = DB 의 balance_snapshot 그대로 (클라이언트 누적 계산 없음)
//   · 스코프 = balance_id(그룹 잔액). 관리자가 상단 드롭다운으로 사용자를 고른다.
//   · 구 원장(invoiceManager_transactions)은 읽지도 쓰지도 않는다. 조회 실패·이월 없는 그룹·
//     합산≠스냅샷은 다른 값으로 덮지 않고 빨간 경고로 표시한다.
//   · 환산금액 = 잔액 × 금일 환율 (참고용 — 기준은 위안)
//
// 기록 (구 고객계좌의 [추가]·[날짜 수정]을 신 원장 방식으로 옮김)
//   · 충전 / 차감      → POST /api/ft/user-transactions  (record_manual_transaction_v2)
//   · 1688 주문 엑셀    → POST /api/ft/user-transactions/order-deduct (RPC v2, 파싱은 서버)
//   · 적용일 클릭 수정  → PATCH /api/ft/user-transactions (applied_date 만)
//   저장 시도마다 참조키(MANUAL-충전-… / MANUAL-차감-…)를 만들어 보내고, 재시도에는 같은 키를
//   다시 보낸다 → 서버가 중복을 막아 더블 클릭·타임아웃 재시도로 두 번 기록되지 않는다.
// ============================================================

const ALL_ACCOUNTS = '전체';

// ── 숫자 포맷 (빈값은 공백, -0 → 0) ──
const fmt = (n: number | null | undefined): string => {
  if (n == null) return '';
  const v = n === 0 ? 0 : n;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

/** 위안 표기 */
const fmtYuan = (n: number) => `¥${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** 오늘 (KST, YYYY-MM-DD) — 모달 날짜 기본값 */
const todayKST = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 표시·월 필터에 쓰는 날짜 — 적용일 우선, 없으면 기록일 */
const rowDateOf = (r: UserTxDisplayRow): string =>
  r.applied_date ? String(r.applied_date).slice(0, 10) : (r.created_at ? r.created_at.slice(0, 10) : '');

/** 드롭다운 항목 — /api/ft/users 응답 */
interface FtUserOption {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
  username: string | null;
}

/** 드롭다운 표시명 — "아이엠몽 BZ" */
const userLabel = (u: FtUserOption): string =>
  [u.vender_name || u.full_name || u.username, u.user_code].filter(Boolean).join(' ');

/** /api/ft/user-transactions GET 응답 */
interface LedgerResponse {
  success: boolean;
  error?: string;
  balanceId: string | null;
  ledger: {
    rows: UserTxDisplayRow[];
    accounts: string[];
    sumBalance: number;
    snapshotBalance: number | null;
    lastDate: string | null;
    hasOpening: boolean;
  };
}

/** 기록 API 공통 응답 */
interface WriteResponse {
  success: boolean;
  error?: string;
  committed?: boolean;
  transactionId?: string | null;
  result?: LedgerWriteResult & { orderCode?: string; itemQty?: number; orderNos1688?: number };
}

type AddModalType = 'charge' | 'deduct' | '1688order';

const PaymentHistoryV2: React.FC = () => {
  const { t } = useTranslation();

  // ── 사용자 선택 (ft_users) ──
  const [ftUsers, setFtUsers] = useState<FtUserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  /** 조회 실패 사유 — 값이 있으면 표 대신 빨간 경고 */
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 신 원장 ──
  const [rows, setRows] = useState<UserTxDisplayRow[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [sumBalance, setSumBalance] = useState(0);
  const [snapshotBalance, setSnapshotBalance] = useState<number | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [hasOpening, setHasOpening] = useState(false);

  // ── 금일 환율 ──
  const [todayRate, setTodayRate] = useState<number | null>(null);

  // ── hover 팝오버 ──
  const [hoverFee, setHoverFee] = useState<{ x: number; y: number; shipping: number; service: number; other: number } | null>(null);
  const [hoverNote, setHoverNote] = useState<{ x: number; y: number; text: string } | null>(null);

  // ── 월 필터 (기본 당월) ──
  const now = useMemo(() => new Date(), []);
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()));
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [String(y + 1), String(y), String(y - 1), String(y - 2)];
  }, [now]);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), []);

  // ── 사업자 필터 ──
  const [selectedAccount, setSelectedAccount] = useState<string>(ALL_ACCOUNTS);

  // ── 적용일 편집 ──
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<string>('');
  const [isSavingDate, setIsSavingDate] = useState(false);

  // ── 추가 모달 ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalType, setAddModalType] = useState<AddModalType>('charge');
  const [isSaving, setIsSaving] = useState(false);
  /** 저장 시도 참조키 — 모달이 열려 있는 동안 재시도에도 같은 키 (서버 중복 차단) */
  const refKeyRef = useRef<{ charge: string | null; deduct: string | null }>({ charge: null, deduct: null });

  const [chargeForm, setChargeForm] = useState({ date: todayKST(), description: '', amount: '', krwAmount: '', adminNote: '' });
  const [deductForm, setDeductForm] = useState({
    date: todayKST(), description: '', amount: '', order1688Id: '', deliveryFee: '', serviceFee: '', extraFee: '', adminNote: '',
  });
  const [orderExcelFile, setOrderExcelFile] = useState<File | null>(null);
  const orderExcelInputRef = useRef<HTMLInputElement>(null);

  // ============================================================
  // 사용자 목록
  // ============================================================
  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/ft/users');
        const result = await response.json();
        if (result.success && result.data) setFtUsers(result.data as FtUserOption[]);
      } catch (error) {
        console.error('사용자 목록 조회 오류:', error);
      }
    };
    load();
  }, []);

  // ── 금일 환율 — 원장 조회와 독립 (실패해도 원장은 그대로 표시) ──
  useEffect(() => {
    let cancelled = false;
    fetchTodayRate()
      .then(r => { if (!cancelled) setTodayRate(r.rate); })
      .catch(err => {
        console.error('고객계좌(신) 환율 조회 오류:', err);
        if (!cancelled) setTodayRate(null);
      });
    return () => { cancelled = true; };
  }, []);

  // ── 드롭다운 변경 시 화면 초기화 (다른 사용자의 데이터가 남지 않도록) ──
  useEffect(() => {
    setHasLoadedData(false);
    setLoadError(null);
    setRows([]);
    setAccounts([]);
    setSumBalance(0);
    setSnapshotBalance(null);
    setLastDate(null);
    setHasOpening(false);
    setSelectedAccount(ALL_ACCOUNTS);
    setEditingDateId(null);
  }, [selectedUserId]);

  // ============================================================
  // 조회
  // ============================================================
  const fetchLedger = useCallback(async (userId: string) => {
    const response = await fetch(`/api/ft/user-transactions?user_id=${encodeURIComponent(userId)}`);
    const result = (await response.json()) as LedgerResponse;
    if (!result.success) throw new Error(result.error || '조회 실패');
    setRows(result.ledger.rows);
    setAccounts(result.ledger.accounts);
    setSumBalance(result.ledger.sumBalance);
    setSnapshotBalance(result.ledger.snapshotBalance);
    setLastDate(result.ledger.lastDate);
    setHasOpening(result.ledger.hasOpening);
    setHasLoadedData(true);
  }, []);

  const handleUpdate = useCallback(async () => {
    if (!selectedUserId) {
      alert('쿠팡 사용자를 선택해주세요.');
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      await fetchLedger(selectedUserId);
    } catch (err) {
      // 조회 실패 — 빈 표로 위장하지 않고 그대로 에러로 표시
      console.error('고객계좌(신) 조회 오류:', err);
      setRows([]);
      setHasLoadedData(false);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedUserId, fetchLedger]);

  // ============================================================
  // 표시 필터 (월 + 사업자) — 적용일 기준. 잔액(balance_snapshot)은 체인 누적값이라 필터와 무관
  // ============================================================
  const monthRows = useMemo(() => {
    const prefix = `${filterYear}-${filterMonth}`;
    return rows.filter(r => {
      if (selectedAccount !== ALL_ACCOUNTS && r.account !== selectedAccount) return false;
      return rowDateOf(r).slice(0, 7) === prefix;
    });
  }, [rows, filterYear, filterMonth, selectedAccount]);

  /** 합산 ≠ 스냅샷 → 원장 체인이 깨진 것 (즉시 경고) */
  const isLedgerBroken = snapshotBalance != null && Math.abs(snapshotBalance - sumBalance) >= 0.005;
  /** 기록 가능 조건 — 조회 완료 + 이월 행 있음 + 정합 */
  const canWrite = hasLoadedData && !loadError && hasOpening && !isLedgerBroken;

  // ============================================================
  // 적용일 수정 (applied_date 만 — 체인·금액은 그대로)
  // ============================================================
  const handleDateClick = (row: UserTxDisplayRow) => {
    if (!canWrite) return;
    setEditingDateId(row.id);
    setEditingDateValue(rowDateOf(row) || todayKST());
  };
  const handleDateCancel = () => {
    setEditingDateId(null);
    setEditingDateValue('');
  };
  const handleDateSave = async (rowId: string) => {
    if (!editingDateValue) return;
    setIsSavingDate(true);
    try {
      const response = await fetch('/api/ft/user-transactions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rowId, applied_date: editingDateValue }),
      });
      const result = await response.json();
      if (!result.success) {
        alert(`적용일 수정 실패: ${result.error}`);
        return;
      }
      setRows(prev => prev.map(r => (r.id === rowId ? { ...r, applied_date: result.data.applied_date } : r)));
      setEditingDateId(null);
      setEditingDateValue('');
    } catch (error) {
      console.error('적용일 수정 오류:', error);
      alert('적용일 수정 중 오류가 발생했습니다.');
    } finally {
      setIsSavingDate(false);
    }
  };

  // ============================================================
  // 추가 모달
  // ============================================================
  const handleCloseModal = () => {
    if (isSaving) return;
    setShowAddModal(false);
    setChargeForm({ date: todayKST(), description: '', amount: '', krwAmount: '', adminNote: '' });
    setDeductForm({ date: todayKST(), description: '', amount: '', order1688Id: '', deliveryFee: '', serviceFee: '', extraFee: '', adminNote: '' });
    setOrderExcelFile(null);
    if (orderExcelInputRef.current) orderExcelInputRef.current.value = '';
    refKeyRef.current = { charge: null, deduct: null };
  };

  /** 참조키 — 첫 저장 시도에 만들고, 실패 후 재시도에는 같은 키를 재사용 */
  const refKeyFor = (kind: 'charge' | 'deduct'): string => {
    const label = kind === 'charge' ? '충전' : '차감';
    if (!refKeyRef.current[kind]) refKeyRef.current[kind] = `MANUAL-${label}-${Date.now()}`;
    return refKeyRef.current[kind] as string;
  };

  const selectedUser = ftUsers.find(u => u.id === selectedUserId) ?? null;

  /** 기록 성공 후 공통 처리 — 알림 + 원장 새로고침 + 모달 닫기 */
  const afterWrite = async (title: string, r: LedgerWriteResult, extra = '') => {
    alert(
      `${title}\n\n` +
      `사업자: ${selectedUser ? userLabel(selectedUser) : ''}\n` +
      `금액: ${fmtYuan(r.amount)}\n` +
      `이전 잔액: ${fmtYuan(r.prevBalance)}\n` +
      `이후 잔액: ${fmtYuan(r.newBalance)}\n` +
      `적용일: ${r.appliedDate}\n` +
      (extra ? `${extra}\n` : '') +
      `거래ID: ${r.transactionId}`,
    );
    refKeyRef.current = { charge: null, deduct: null };
    setIsSaving(false);
    setShowAddModal(false);
    setChargeForm({ date: todayKST(), description: '', amount: '', krwAmount: '', adminNote: '' });
    setDeductForm({ date: todayKST(), description: '', amount: '', order1688Id: '', deliveryFee: '', serviceFee: '', extraFee: '', adminNote: '' });
    setOrderExcelFile(null);
    if (orderExcelInputRef.current) orderExcelInputRef.current.value = '';
    await handleUpdate();
  };

  /** 기록 실패 공통 처리 — committed 면 "기록됨·검증 실패" 경고 후 새로고침 */
  const afterWriteError = async (result: WriteResponse) => {
    if (result.committed) {
      alert(result.error || '기록은 됐으나 검증에 실패했습니다. 관리자 확인 필요.');
      refKeyRef.current = { charge: null, deduct: null };
      setShowAddModal(false);
      await handleUpdate();
    } else {
      alert(result.error || '기록 실패');
    }
  };

  // ── 충전 ──
  const handleSaveCharge = async () => {
    if (!selectedUser) return alert('쿠팡 사용자를 선택해주세요.');
    const amount = Number(chargeForm.amount);
    if (!chargeForm.amount || !(amount > 0)) return alert('전체금액을 입력해주세요.');
    const krw = chargeForm.krwAmount ? Number(chargeForm.krwAmount) : null;
    if (krw != null && !(krw > 0)) return alert('원화 금액은 0보다 커야 합니다.');
    if (!chargeForm.date) return alert('적용일을 입력해주세요.');
    const description = chargeForm.description.trim() || '충전';

    const ok = confirm(
      `충전을 기록합니다.\n\n사업자: ${userLabel(selectedUser)}\n항목: ${description}\n금액: ${fmtYuan(amount)}` +
      (krw != null ? `\n원화: ₩${krw.toLocaleString()} (환율 ₩${(krw / amount).toFixed(2)}/¥)` : '\n원화: (미입력)') +
      `\n적용일: ${chargeForm.date}\n\n진행할까요?`,
    );
    if (!ok) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/ft/user-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'charge',
          user_id: selectedUser.id,
          amount,
          krw_amount: krw,
          applied_date: chargeForm.date,
          description,
          reference_id: refKeyFor('charge'),
          admin_note: chargeForm.adminNote || null,
        }),
      });
      const result = (await response.json()) as WriteResponse;
      if (result.success && result.result) await afterWrite('충전 완료', result.result);
      else await afterWriteError(result);
    } catch (error) {
      console.error('충전 기록 오류:', error);
      alert('충전 기록 중 오류가 발생했습니다. 화면을 새로고침해 기록 여부를 확인한 뒤 다시 시도하세요.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── 차감 ──
  const handleSaveDeduct = async () => {
    if (!selectedUser) return alert('쿠팡 사용자를 선택해주세요.');
    const amount = Number(deductForm.amount);
    if (!deductForm.amount || !(amount > 0)) return alert('전체금액을 입력해주세요.');
    const description = deductForm.description.trim();
    if (!description) return alert('항목을 입력해주세요.');
    if (!deductForm.date) return alert('적용일을 입력해주세요.');
    const fee = (v: string) => (v ? Number(v) : 0);
    const ship = fee(deductForm.deliveryFee);
    const svc = fee(deductForm.serviceFee);
    const other = fee(deductForm.extraFee);
    if ([ship, svc, other].some(v => !Number.isFinite(v) || v < 0)) return alert('배송비·서비스비·기타비용은 0 이상이어야 합니다.');
    const itemAmount = Math.round((amount - ship - svc - other) * 100) / 100;
    if (itemAmount < 0) return alert('배송비·서비스비·기타비용 합계가 전체금액을 초과합니다.');

    const ok = confirm(
      `차감을 기록합니다.\n\n사업자: ${userLabel(selectedUser)}\n항목: ${description}\n전체금액: ${fmtYuan(amount)}\n` +
      `  지출 ${fmtYuan(itemAmount)} + 배송비 ${fmtYuan(ship)} + 서비스비 ${fmtYuan(svc)} + 기타 ${fmtYuan(other)}\n` +
      (deductForm.order1688Id ? `1688 주문번호: ${deductForm.order1688Id}\n` : '') +
      `적용일: ${deductForm.date}\n\n진행할까요?`,
    );
    if (!ok) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/ft/user-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'deduct',
          user_id: selectedUser.id,
          amount,
          applied_date: deductForm.date,
          description,
          reference_id: refKeyFor('deduct'),
          order_no_1688: deductForm.order1688Id || null,
          shipping_fee: ship,
          service_fee: svc,
          other_fee: other,
          admin_note: deductForm.adminNote || null,
        }),
      });
      const result = (await response.json()) as WriteResponse;
      if (result.success && result.result) await afterWrite('차감 완료', result.result);
      else await afterWriteError(result);
    } catch (error) {
      console.error('차감 기록 오류:', error);
      alert('차감 기록 중 오류가 발생했습니다. 화면을 새로고침해 기록 여부를 확인한 뒤 다시 시도하세요.');
    } finally {
      setIsSaving(false);
    }
  };

  // ── 1688 주문 엑셀 ──
  const handleOrderExcelSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) {
      alert('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.');
      event.target.value = '';
      return;
    }
    setOrderExcelFile(file);
  };

  const handleSave1688Order = async () => {
    if (!selectedUser) return alert('쿠팡 사용자를 선택해주세요.');
    if (!orderExcelFile) return alert('엑셀 파일을 선택해주세요.');

    // 금액은 서버가 엑셀에서 계산·검증한다 (auto-1688-order 와 동일 규칙). 여기서는 파일·사업자만 확인.
    const ok = confirm(
      `1688 주문 엑셀로 구매 차감을 기록합니다.\n\n사업자: ${userLabel(selectedUser)}\n파일: ${orderExcelFile.name}\n` +
      `적용일: 오늘 (${todayKST()})\n\n같은 주문코드는 두 번 차감되지 않습니다. 진행할까요?`,
    );
    if (!ok) return;

    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', orderExcelFile);
      formData.append('user_id', selectedUser.id);
      const response = await fetch('/api/ft/user-transactions/order-deduct', { method: 'POST', body: formData });
      const result = (await response.json()) as WriteResponse;
      if (result.success && result.result) {
        const r = result.result;
        await afterWrite('1688 주문 차감 완료', r, `주문코드: ${r.orderCode}\n수량: ${r.itemQty}개 / 1688 주문 ${r.orderNos1688}건`);
      } else {
        await afterWriteError(result);
      }
    } catch (error) {
      console.error('1688 주문 차감 오류:', error);
      alert('1688 주문 차감 중 오류가 발생했습니다. 화면을 새로고침해 기록 여부를 확인한 뒤 다시 시도하세요.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => {
    if (isSaving) return;
    if (addModalType === 'charge') handleSaveCharge();
    else if (addModalType === 'deduct') handleSaveDeduct();
    else handleSave1688Order();
  };

  // ============================================================
  // 렌더링
  // ============================================================
  return (
    <div className="phv2-layout">
      <TopsideMenu />
      <div className="phv2-main-content">
        <LeftsideMenu />
        <main className="phv2-content">
          <div className="phv2-container">

            {/* ── 타이틀 행 ── */}
            <div className="phv2-title-row">
              <div className="phv2-title-group">
                <h1 className="phv2-title">고객계좌 (신)</h1>
                <span className="phv2-badge-ledger">새 원장</span>
                {monthRows.length > 0 && (
                  <span className="phv2-count">총 {monthRows.length.toLocaleString()}건</span>
                )}
              </div>
              <div className="phv2-title-controls">
                <select
                  className="phv2-user-dropdown"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                >
                  <option value="">{t('importProduct.selectUser')}</option>
                  {ftUsers.map((user) => (
                    <option key={user.id} value={user.id}>{userLabel(user)}</option>
                  ))}
                </select>
                <button className="phv2-update-btn" onClick={handleUpdate} disabled={!selectedUserId || isLoading}>
                  {isLoading ? (
                    <span className="phv2-button-loading">
                      <span className="phv2-spinner"></span>
                      {t('importProduct.refresh')}
                    </span>
                  ) : (
                    t('importProduct.refresh')
                  )}
                </button>
                <button
                  className="phv2-add-btn"
                  onClick={() => setShowAddModal(true)}
                  disabled={!canWrite}
                  title={!hasLoadedData ? '먼저 사용자를 선택하고 업데이트하세요' : !canWrite ? '원장 상태에 문제가 있어 기록할 수 없습니다' : ''}
                >
                  추가
                </button>
              </div>
            </div>

            {/* ── 조회 실패 — 다른 데이터로 대신하지 않고 그대로 경고 ── */}
            {!isLoading && loadError && (
              <div className="phv2-alert-error">
                <strong>원장 조회 실패 — 관리자 확인 필요.</strong> <span className="phv2-alert-detail">{loadError}</span>
              </div>
            )}

            {/* ── 잔액 + 원장 정합성 (신 원장이 유일한 기준) ── */}
            {!isLoading && hasLoadedData && !loadError && (
              <div className="phv2-compare-row">
                <span className="phv2-compare-item">
                  잔액{' '}
                  <span className="phv2-compare-value">{snapshotBalance != null ? fmtYuan(snapshotBalance) : '-'}</span>
                  {lastDate && <span className="phv2-compare-muted"> (~{lastDate})</span>}
                </span>
                <span className="phv2-compare-dot">·</span>
                {rows.length === 0 || !hasOpening ? (
                  <span className="phv2-pill is-broken">⚠ 신 원장에 이월 행이 없습니다 (미전환 그룹) — 기록 불가, 관리자 확인 필요</span>
                ) : isLedgerBroken ? (
                  <span className="phv2-pill is-broken">
                    ⚠ 원장 정합성 오류: 합산 {fmtYuan(sumBalance)} ≠ 스냅샷 {fmtYuan(snapshotBalance as number)} — 기록 불가, 관리자 확인 필요
                  </span>
                ) : (
                  <span className="phv2-pill is-matched">✓ 원장 정합 (합산 = 스냅샷)</span>
                )}
              </div>
            )}

            {/* ── 월 + 사업자 필터 ── */}
            <div className="phv2-filter-row">
              <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="phv2-select">
                {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="phv2-select">
                {monthOptions.map(m => <option key={m} value={m}>{parseInt(m, 10)}월</option>)}
              </select>
              <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="phv2-select">
                <option value={ALL_ACCOUNTS}>{ALL_ACCOUNTS}</option>
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              {selectedAccount !== ALL_ACCOUNTS && (
                <span className="phv2-filter-hint">※ 잔액은 그룹(전체) 누적값입니다</span>
              )}
              <span className="phv2-rate-note">
                환산금액은 보기 편하게 하기 위한 금일 환율로 적용된 금액이며 매일 약간씩 변동될 수 있습니다.
              </span>
            </div>

            {/* ── 테이블 ── */}
            <div className="phv2-table-board">
              {isLoading ? (
                <div className="phv2-empty">
                  <span className="phv2-spinner phv2-spinner-dark"></span>
                  <span>{t('importProduct.table.loading')}</span>
                </div>
              ) : loadError ? (
                <div className="phv2-empty phv2-empty-error">원장을 불러오지 못했습니다. 관리자에게 알려주세요.</div>
              ) : !hasLoadedData ? (
                <div className="phv2-empty">사용자를 선택하고 [{t('importProduct.refresh')}] 를 눌러주세요.</div>
              ) : monthRows.length === 0 ? (
                <div className="phv2-empty">해당 월의 거래내역이 없습니다.</div>
              ) : (
                <table className="phv2-table">
                  <thead>
                    <tr>
                      {/* 적용일 — 클릭하여 수정 (applied_date 만 바뀜, 잔액·순서는 그대로) */}
                      <th className="phv2-th phv2-th-left">적용일</th>
                      <th className="phv2-th phv2-th-left">사업자</th>
                      <th className="phv2-th phv2-th-center">타입</th>
                      <th className="phv2-th phv2-th-left phv2-th-desc">내용</th>
                      <th className="phv2-th phv2-th-center">수량</th>
                      <th className="phv2-th phv2-th-right">지출금액</th>
                      <th className="phv2-th phv2-th-right">배송비</th>
                      <th className="phv2-th phv2-th-right">서비스비</th>
                      <th className="phv2-th phv2-th-right">기타비용</th>
                      <th className="phv2-th phv2-th-right">총비용</th>
                      <th className="phv2-th phv2-th-right">충전</th>
                      <th className="phv2-th phv2-th-right">환불</th>
                      <th className="phv2-th phv2-th-right">잔액</th>
                      <th className="phv2-th phv2-th-right">환산금액</th>
                      <th className="phv2-th phv2-th-left phv2-th-ref">참조</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map(row => {
                      const isIn = row.type === 'in';
                      const isRefund = isIn && row.category === '환불';
                      const amt = Number(row.amount ?? 0);
                      const rowClass = isIn ? 'phv2-row-in' : row.type === 'out' ? 'phv2-row-out' : '';

                      // out 은 비용 분해를 음수로, in 은 해당 열에만 표기
                      const expense  = !isIn ? -Number(row.item_amount  ?? 0) : null;
                      const delivery = !isIn ? -Number(row.shipping_fee ?? 0) : null;
                      const service  = !isIn ? -Number(row.service_fee  ?? 0) : null;
                      const extra    = !isIn ? -Number(row.other_fee    ?? 0) : null;
                      const total    = !isIn ? -amt : null;
                      const charge   = isIn && !isRefund ? amt : null;
                      const refund   = isRefund ? amt : null;
                      const hasNote  = !!(row.admin_note && row.admin_note.trim() !== '');

                      const snap = row.balance_snapshot != null ? Number(row.balance_snapshot) : null;
                      const krw  = todayRate != null && snap != null ? snap * todayRate : null;
                      const dateText = rowDateOf(row);

                      return (
                        <tr key={row.id} className={rowClass}>
                          {/* 적용일 (클릭하여 수정) */}
                          <td className="phv2-td phv2-td-left phv2-date-cell">
                            {editingDateId === row.id ? (
                              <div className="phv2-date-edit">
                                <input
                                  type="date"
                                  className="phv2-date-input"
                                  value={editingDateValue}
                                  max={todayKST()}
                                  onChange={(e) => setEditingDateValue(e.target.value)}
                                  autoFocus
                                />
                                <button className="phv2-date-save-btn" onClick={() => handleDateSave(row.id)} disabled={isSavingDate}>✓</button>
                                <button className="phv2-date-cancel-btn" onClick={handleDateCancel} disabled={isSavingDate}>✕</button>
                              </div>
                            ) : (
                              <span
                                className={`phv2-date-text ${canWrite ? 'is-editable' : ''}`}
                                title={canWrite ? `클릭하여 적용일 수정 (기록일 ${row.created_at ? row.created_at.slice(0, 10) : '-'})` : ''}
                                onClick={() => handleDateClick(row)}
                              >
                                {dateText || '-'}
                              </span>
                            )}
                          </td>
                          <td className="phv2-td phv2-td-left">{row.account}</td>
                          <td className="phv2-td phv2-td-center">{row.category || row.type || '-'}</td>
                          <td
                            className={`phv2-td phv2-td-left phv2-td-desc ${hasNote ? 'is-help' : ''}`}
                            title={row.description ?? ''}
                            onMouseEnter={hasNote ? e => setHoverNote({ x: e.clientX + 14, y: e.clientY + 10, text: row.admin_note as string }) : undefined}
                            onMouseMove={hasNote ? e => setHoverNote(prev => prev && { ...prev, x: e.clientX + 14, y: e.clientY + 10 }) : undefined}
                            onMouseLeave={hasNote ? () => setHoverNote(null) : undefined}
                          >
                            {row.description || '-'}
                            {hasNote && <span className="phv2-note-pin" aria-label="관리자비고 있음">📌</span>}
                          </td>
                          <td className="phv2-td phv2-td-center phv2-td-num">{row.qty ?? ''}</td>
                          <td
                            className={`phv2-td phv2-td-right ${!isIn ? 'is-help' : ''}`}
                            onMouseEnter={!isIn ? e => setHoverFee({
                              x: e.clientX + 14, y: e.clientY + 10,
                              shipping: Number(row.shipping_fee ?? 0), service: Number(row.service_fee ?? 0), other: Number(row.other_fee ?? 0),
                            }) : undefined}
                            onMouseMove={!isIn ? e => setHoverFee(prev => prev && { ...prev, x: e.clientX + 14, y: e.clientY + 10 }) : undefined}
                            onMouseLeave={!isIn ? () => setHoverFee(null) : undefined}
                          >
                            {fmt(expense)}
                          </td>
                          <td className="phv2-td phv2-td-right">{fmt(delivery)}</td>
                          <td className="phv2-td phv2-td-right">{fmt(service)}</td>
                          <td className="phv2-td phv2-td-right">{fmt(extra)}</td>
                          <td className="phv2-td phv2-td-right phv2-td-total">{fmt(total)}</td>
                          <td className="phv2-td phv2-td-right phv2-td-charge">{fmt(charge)}</td>
                          <td className="phv2-td phv2-td-right phv2-td-refund">{fmt(refund)}</td>
                          <td className="phv2-td phv2-td-right phv2-td-balance">{fmt(snap)}</td>
                          <td
                            className="phv2-td phv2-td-right"
                            title={todayRate != null ? `금일 환율 ₩${todayRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/¥` : '환율을 불러오지 못했습니다'}
                          >
                            {krw != null ? `₩${Math.round(krw).toLocaleString()}` : '-'}
                          </td>
                          <td className="phv2-td phv2-td-left phv2-td-ref" title={row.reference_id ?? row.order_no_1688 ?? ''}>
                            {row.reference_id || row.order_no_1688 || ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* ── 지출금액 hover 팝오버 ── */}
      {hoverFee && (
        <div className="phv2-popover" style={{ left: hoverFee.x, top: hoverFee.y }}>
          <div className="phv2-popover-card">
            <div className="phv2-popover-line"><span className="phv2-popover-label">배송비</span><span>{fmt(-hoverFee.shipping)}</span></div>
            <div className="phv2-popover-line"><span className="phv2-popover-label">서비스비</span><span>{fmt(-hoverFee.service)}</span></div>
            <div className="phv2-popover-line"><span className="phv2-popover-label">기타비용</span><span>{fmt(-hoverFee.other)}</span></div>
          </div>
        </div>
      )}

      {/* ── 내용 hover 팝오버 — 관리자비고 ── */}
      {hoverNote && (
        <div className="phv2-popover" style={{ left: hoverNote.x, top: hoverNote.y }}>
          <div className="phv2-popover-card phv2-popover-note">
            <div className="phv2-popover-title">📌 관리자비고</div>
            <div>{hoverNote.text}</div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 추가 모달 — 충전 / 차감 / 1688 주문 (신 원장 기록)              */}
      {/* ============================================================ */}
      {showAddModal && (
        <div className="phv2-modal-overlay" onClick={handleCloseModal}>
          <div className="phv2-modal" onClick={(e) => e.stopPropagation()}>
            <div className="phv2-modal-title">
              결제 추가 <span className="phv2-modal-subtitle">{selectedUser ? userLabel(selectedUser) : ''} · 신 원장</span>
            </div>

            <div className="phv2-modal-type-buttons">
              <button className={`phv2-modal-type-btn charge ${addModalType === 'charge' ? 'active' : ''}`} onClick={() => setAddModalType('charge')} disabled={isSaving}>충전</button>
              <button className={`phv2-modal-type-btn deduct ${addModalType === 'deduct' ? 'active' : ''}`} onClick={() => setAddModalType('deduct')} disabled={isSaving}>차감</button>
              <button className={`phv2-modal-type-btn order ${addModalType === '1688order' ? 'active' : ''}`} onClick={() => setAddModalType('1688order')} disabled={isSaving}>1688 주문</button>
            </div>

            <div className="phv2-modal-content">
              {/* ── 충전 폼 ── */}
              {addModalType === 'charge' && (
                <div className="phv2-form">
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>적용일</label>
                      <input type="date" value={chargeForm.date} max={todayKST()} onChange={(e) => setChargeForm({ ...chargeForm, date: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>항목</label>
                      <input type="text" placeholder='항목 (비우면 "충전")' value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-row phv2-form-row-half">
                    <div className="phv2-form-item">
                      <label>전체금액 (위안)</label>
                      <input type="number" min="0" step="0.01" placeholder="충전 위안 금액" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
                    </div>
                    <div className="phv2-form-item">
                      <label>원화 송금액 (KRW)</label>
                      <input type="number" min="0" step="1" placeholder="환율 계산용 (선택)" value={chargeForm.krwAmount} onChange={(e) => setChargeForm({ ...chargeForm, krwAmount: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>관리자 비고</label>
                      <textarea placeholder="비고를 입력하세요" rows={3} value={chargeForm.adminNote} onChange={(e) => setChargeForm({ ...chargeForm, adminNote: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 차감 폼 ── */}
              {addModalType === 'deduct' && (
                <div className="phv2-form">
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>적용일</label>
                      <input type="date" value={deductForm.date} max={todayKST()} onChange={(e) => setDeductForm({ ...deductForm, date: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>항목</label>
                      <input type="text" placeholder="항목을 입력하세요" value={deductForm.description} onChange={(e) => setDeductForm({ ...deductForm, description: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-quick">
                    {['속포장 비닐', '겉포장 비닐', '택배박스', '감열지 라벨', '공임비'].map(label => (
                      <button key={label} type="button" onClick={() => setDeductForm({ ...deductForm, description: label })}>{label}</button>
                    ))}
                  </div>
                  <div className="phv2-form-row phv2-form-row-half">
                    <div className="phv2-form-item">
                      <label>1688 주문번호</label>
                      <input type="text" placeholder="1688 주문번호 (선택)" value={deductForm.order1688Id} onChange={(e) => setDeductForm({ ...deductForm, order1688Id: e.target.value })} />
                    </div>
                    <div className="phv2-form-item">
                      <label>전체금액 (위안)</label>
                      <input type="number" min="0" step="0.01" placeholder="(배송비, 서비스, 기타.. 모든 비용 포함)" value={deductForm.amount} onChange={(e) => setDeductForm({ ...deductForm, amount: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-row phv2-form-row-third">
                    <div className="phv2-form-item">
                      <label>배송비</label>
                      <input type="number" min="0" step="0.01" placeholder="배송비" value={deductForm.deliveryFee} onChange={(e) => setDeductForm({ ...deductForm, deliveryFee: e.target.value })} />
                    </div>
                    <div className="phv2-form-item">
                      <label>서비스</label>
                      <input type="number" min="0" step="0.01" placeholder="서비스비용" value={deductForm.serviceFee} onChange={(e) => setDeductForm({ ...deductForm, serviceFee: e.target.value })} />
                    </div>
                    <div className="phv2-form-item">
                      <label>기타</label>
                      <input type="number" min="0" step="0.01" placeholder="기타비용" value={deductForm.extraFee} onChange={(e) => setDeductForm({ ...deductForm, extraFee: e.target.value })} />
                    </div>
                  </div>
                  <div className="phv2-form-hint">지출금액 = 전체금액 − (배송비 + 서비스 + 기타). 비용 합계는 전체금액을 넘을 수 없습니다.</div>
                  <div className="phv2-form-row">
                    <div className="phv2-form-item">
                      <label>관리자 비고</label>
                      <textarea placeholder="비고를 입력하세요" rows={3} value={deductForm.adminNote} onChange={(e) => setDeductForm({ ...deductForm, adminNote: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 1688 주문 — 엑셀 업로드 ── */}
              {addModalType === '1688order' && (
                <div className="phv2-upload">
                  <div className="phv2-form-hint">
                    1688 주문 내보내기 엑셀(AD열 주문코드 1개)을 올리면 서버가 배송비·상품가·서비스비(6%)를 계산해 구매 차감으로 기록합니다.
                    적용일은 오늘({todayKST()})로 기록되며, 필요하면 저장 후 표의 적용일을 클릭해 수정할 수 있습니다.
                    같은 주문코드는 두 번 차감되지 않습니다.
                  </div>
                  <input
                    type="file"
                    id="phv2-excel-upload"
                    ref={orderExcelInputRef}
                    accept=".xlsx,.xls"
                    style={{ display: 'none' }}
                    onChange={handleOrderExcelSelect}
                  />
                  <label htmlFor="phv2-excel-upload" className="phv2-upload-area">
                    <div className="phv2-upload-icon">{orderExcelFile ? '✅' : '📁'}</div>
                    <div className="phv2-upload-text">{orderExcelFile ? orderExcelFile.name : '클릭하여 엑셀 파일을 선택하세요'}</div>
                    <div className="phv2-upload-hint">{orderExcelFile ? '다른 파일을 선택하려면 클릭하세요' : '.xlsx, .xls 파일만 업로드 가능합니다'}</div>
                  </label>
                </div>
              )}
            </div>

            <div className="phv2-modal-footer">
              <button className="phv2-modal-cancel-btn" onClick={handleCloseModal} disabled={isSaving}>취소</button>
              <button className="phv2-modal-save-btn" onClick={handleSave} disabled={isSaving}>
                {isSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentHistoryV2;
