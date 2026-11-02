'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useFtUsers, type FtUser } from '../../import-product-v2/hooks/useFtData';
import { useWorkers, workerLabel } from '../../shipment-v2/hooks/useWorkers';
import type { Worker } from '../../shipment-v2/types';
import type { PendingRow, StockRow } from '../types';
import { useStorageRows } from './useStorageRows';

// ============================================================
// StorageContext — /storage 두 탭([작업중] [재고])이 공유하는 상태
//
//   · 사용자(ft_users) · 담당자(/api/hr/workers) 선택 — 탭을 옮겨도 유지
//   · 작업중 줄 · 재고 칸을 함께 들고 있다 → 헤더 요약 카드가 두 탭 수치를 같이 보여준다
//   · reloadAll: 배치·쉽먼트·이동 뒤 두 목록을 다시 읽는다 (배치하면 작업중 ↓ 재고 ↑)
//   선택값은 sessionStorage 에 둔다 (새로고침해도 같은 사용자·담당자로 계속 작업)
// ============================================================

const SS_USER = 'storage.userId';
const SS_WORKER = 'storage.worker';

/** 보관일수 경고 기준 (헤더 카드 · 재고 표 강조) */
export const AGED_DAYS = 30;

interface StorageContextValue {
  ftUsers: FtUser[];
  userId: string;
  setUserId: (id: string) => void;
  userCode: string;
  workers: Worker[];
  worker: string;
  setWorker: (label: string) => void;
  pending: { rows: PendingRow[]; loading: boolean; loadError: boolean };
  stock: { rows: StockRow[]; loading: boolean; loadError: boolean };
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

  const [userId, setUserIdState] = useState('');
  const [worker, setWorkerState] = useState('');

  // ── 마운트 후 sessionStorage 복원 (SSR 단계에서는 window 없음) ──
  useEffect(() => {
    setUserIdState(readSession(SS_USER));
    setWorkerState(readSession(SS_WORKER));
  }, []);

  const setUserId = useCallback((id: string) => { setUserIdState(id); writeSession(SS_USER, id); }, []);
  const setWorker = useCallback((label: string) => { setWorkerState(label); writeSession(SS_WORKER, label); }, []);

  // ── 저장된 담당자가 퇴사 등으로 목록에서 빠졌으면 비운다 ──
  useEffect(() => {
    if (worker && workers.length > 0 && !workers.some((w) => workerLabel(w) === worker)) setWorker('');
  }, [worker, workers, setWorker]);

  const pending = useStorageRows<PendingRow>('/api/ft/storage/pending');
  const stock = useStorageRows<StockRow>('/api/ft/storage/stock');
  const fetchPending = pending.fetchRows;
  const fetchStock = stock.fetchRows;

  const reloadAll = useCallback(() => {
    fetchPending(userId);
    fetchStock(userId);
  }, [userId, fetchPending, fetchStock]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const userCode = ftUsers.find((u) => u.id === userId)?.user_code ?? '';

  const value = useMemo<StorageContextValue>(() => ({
    ftUsers, userId, setUserId, userCode, workers, worker, setWorker,
    pending: { rows: pending.rows, loading: pending.loading, loadError: pending.loadError },
    stock: { rows: stock.rows, loading: stock.loading, loadError: stock.loadError },
    reloadAll,
  }), [
    ftUsers, userId, setUserId, userCode, workers, worker, setWorker,
    pending.rows, pending.loading, pending.loadError,
    stock.rows, stock.loading, stock.loadError,
    reloadAll,
  ]);

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
};

export function useStorage(): StorageContextValue {
  const ctx = useContext(StorageContext);
  if (!ctx) throw new Error('useStorage 는 StorageProvider 안에서만 사용할 수 있습니다.');
  return ctx;
}
