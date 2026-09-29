import { useCallback, useEffect, useState } from 'react';
import { dbAccessHeaders } from '../../../../component/DbAccessGate';
import type { TradePnlRow, TradeRow, TradeStatus } from '../../../../lib/tradeLedger';

// ============================================================
// 무역계좌 API 훅 — 상태 / 원장 / 손익 조회 + 기록 호출 helper
//   모든 요청에 DB 관리 접근 코드 헤더(dbAccessHeaders)를 싣는다.
// ============================================================

interface ApiResult<T> {
  success: boolean;
  error?: string;
  data: T;
}

/** 공용 fetch — 실패 시 서버 문구를 그대로 throw */
export async function tradeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/trade-account/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...dbAccessHeaders(), ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '요청 실패');
  return json as T;
}

// ── 상태 ──
export function useTradeStatus() {
  const [status, setStatus] = useState<TradeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await tradeFetch<{ status: TradeStatus }>('status');
      setStatus(json.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : '상태 조회 실패');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { status, loading, error, reload };
}

// ── 원장 (적용일 구간) ──
export function useTradeLedger(from: string, to: string, refreshKey: number) {
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await tradeFetch<{ rows: TradeRow[] }>(`ledger?from=${from}&to=${to}`);
        if (!signal.cancelled) setRows(json.rows);
      } catch (e) {
        if (!signal.cancelled) { setError(e instanceof Error ? e.message : '조회 실패'); setRows([]); }
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [from, to, refreshKey]);

  return { rows, loading, error };
}

// ── 손익 ──
export function useTradePnl(unit: 'day' | 'month', from: string, to: string, refreshKey: number) {
  const [periods, setPeriods] = useState<TradePnlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await tradeFetch<{ periods: TradePnlRow[] }>(`pnl?unit=${unit}&from=${from}&to=${to}`);
        if (!signal.cancelled) setPeriods(json.periods);
      } catch (e) {
        if (!signal.cancelled) { setError(e instanceof Error ? e.message : '조회 실패'); setPeriods([]); }
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    })();
    return () => { signal.cancelled = true; };
  }, [unit, from, to, refreshKey]);

  return { periods, loading, error };
}

// ── 날짜 helper ──
export const monthRange = (year: number, month: number): { from: string; to: string } => {
  const mm = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
};
