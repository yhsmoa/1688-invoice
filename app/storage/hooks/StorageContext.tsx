'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useFtUsers, type FtUser } from '../../import-product-v2/hooks/useFtData';
import { useWorkers, workerLabel } from '../../shipment-v2/hooks/useWorkers';
import type { Worker } from '../../shipment-v2/types';
import type { PendingRow, StockRow, StorageRequest, WowLine } from '../types';
import { useStorageRows } from './useStorageRows';

// ============================================================
// StorageContext — /storage 세 탭([작업중] [재고] [와우출고])이 공유하는 상태
//
//   · 사업자 탭('' = 전체) · 담당자(/api/hr/workers) 선택 — 탭을 옮겨도 유지
//   · 목록은 전체 사업자를 한 번에 받아 사업자 탭으로 거른다 → 헤더 요약 카드도 같은 범위
//   · 모달은 행의 user_id 로 동작한다 (전체 탭에서도 행의 사업자)
//   · reloadAll: 배치·쉽먼트·이동·담기 뒤 목록을 다시 읽는다
//   선택값은 sessionStorage 에 둔다 (새로고침해도 같은 탭·담당자로 계속 작업)
// ============================================================

const SS_TAB = 'storage.userTab';
const SS_WORKER = 'storage.worker';

/** 보관일수 경고 기준 (헤더 카드 · 재고 표 강조) */
export const AGED_DAYS = 30;

interface Rows<T> { rows: T[]; loading: boolean; loadError: boolean }

interface StorageContextValue {
  ftUsers: FtUser[];
  /** 사업자 탭 — '' = 전체 */
  tab: string;
  setTab: (userId: string) => void;
  userCodeOf: (userId: string) => string;
  workers: Worker[];
  worker: string;
  setWorker: (label: string) => void;
  pending: Rows<PendingRow>;
  stock: Rows<StockRow>;
  wow: Rows<WowLine>;
  /** 고객 쉽먼트 요청 — 미처리 + 24h 내 완료 */
  requests: StorageRequest[];
  reloadAll: () => void;
}

const StorageContext = createContext<StorageContextValue | null>(null);

// ── sessionStorage 는 비공개 창 등에서 막힐 수 있다 → 실패해도 동작 ──
const readSession = (key: string): string => {
  try { return window.sessionStorage.getItem(key) ?? ''; } catch { return ''; }
};
const writeSession = (key: string, value: string) => {
  try { window.sessionStorage.setItem(key, value); } catch { /* 저장 못 해도 화면 동작에는 영향 없음 */ }
};

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { users: ftUsers } = useFtUsers();
  const workers = useWorkers();

  const [tab, setTabState] = useState('');
  const [worker, setWorkerState] = useState('');

  // ── 마운트 후 sessionStorage 복원 (SSR 단계에서는 window 없음) ──
  useEffect(() => {
    setTabState(readSession(SS_TAB));
    setWorkerState(readSession(SS_WORKER));
  }, []);

  const setTab = useCallback((id: string) => { setTabState(id); writeSession(SS_TAB, id); }, []);
  const setWorker = useCallback((label: string) => { setWorkerState(label); writeSession(SS_WORKER, label); }, []);

  // ── 저장된 담당자가 퇴사 등으로 목록에서 빠졌으면 비운다 ──
  useEffect(() => {
    if (worker && workers.length > 0 && !workers.some((w) => workerLabel(w) === worker)) setWorker('');
  }, [worker, workers, setWorker]);

  const pending = useStorageRows<PendingRow>('/api/ft/storage/pending');
  const stock = useStorageRows<StockRow>('/api/ft/storage/stock');
  const wow = useStorageRows<WowLine>('/api/ft/storage/wow');
  const requests = useStorageRows<StorageRequest>('/api/ft/storage/requests');
  const fetchPending = pending.fetchRows;
  const fetchStock = stock.fetchRows;
  const fetchWow = wow.fetchRows;
  const fetchRequests = requests.fetchRows;

  const reloadAll = useCallback(() => {
    fetchPending();
    fetchStock();
    fetchWow();
    fetchRequests();
  }, [fetchPending, fetchStock, fetchWow, fetchRequests]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const userCodeOf = useCallback(
    (userId: string) => ftUsers.find((u) => u.id === userId)?.user_code ?? '',
    [ftUsers]
  );

  const value = useMemo<StorageContextValue>(() => {
    const inTab = <T extends { user_id: string }>(rows: T[]) => (tab ? rows.filter((r) => r.user_id === tab) : rows);
    return {
      ftUsers, tab, setTab, userCodeOf, workers, worker, setWorker,
      pending: { rows: inTab(pending.rows), loading: pending.loading, loadError: pending.loadError },
      stock: { rows: inTab(stock.rows), loading: stock.loading, loadError: stock.loadError },
      wow: { rows: inTab(wow.rows), loading: wow.loading, loadError: wow.loadError },
      requests: inTab(requests.rows),
      reloadAll,
    };
  }, [
    ftUsers, tab, setTab, userCodeOf, workers, worker, setWorker,
    pending.rows, pending.loading, pending.loadError,
    stock.rows, stock.loading, stock.loadError,
    wow.rows, wow.loading, wow.loadError,
    requests.rows,
    reloadAll,
  ]);

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
};

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error('useStorage 는 StorageProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
