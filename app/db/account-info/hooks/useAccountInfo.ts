'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AccountInfo, AccountInfoForm } from '../types';

// ============================================================
// 계좌정보 데이터 훅 — /api/db/account-info 조회·등록·수정·삭제
//   접근 코드 없이 호출 (계좌정보는 잠금 없음)
//   등록·수정·삭제 성공 시 서버 응답으로 목록을 바로 갱신 (재조회 없음)
// ============================================================

const API = '/api/db/account-info';

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 실패 응답이면 서버 메시지로 throw */
async function parse<T>(res: Response, fallback: string): Promise<T | undefined> {
  const json: ApiResult<T> = await res.json();
  if (!json.success) throw new Error(json.error || fallback);
  return json.data;
}

export function useAccountInfo() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 목록 조회 ──
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(API);
      setAccounts((await parse<AccountInfo[]>(res, '계좌정보를 불러오지 못했습니다.')) ?? []);
    } catch (err) {
      console.error('계좌정보 조회 오류:', err);
      setLoadError(err instanceof Error ? err.message : '계좌정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── 등록 ──
  const create = useCallback(async (fields: AccountInfoForm) => {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const created = await parse<AccountInfo>(res, '저장에 실패했습니다.');
    if (created) setAccounts((prev) => [created, ...prev]);
  }, []);

  // ── 수정 ──
  const update = useCallback(async (id: string, fields: AccountInfoForm) => {
    const res = await fetch(API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, fields }),
    });
    const updated = await parse<AccountInfo>(res, '수정에 실패했습니다.');
    if (updated) setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
  }, []);

  // ── 삭제 ──
  const remove = useCallback(async (id: string) => {
    const res = await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await parse<undefined>(res, '삭제에 실패했습니다.');
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return { accounts, loading, loadError, reload, create, update, remove };
}
