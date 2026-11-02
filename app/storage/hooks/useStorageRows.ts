'use client';

import { useCallback, useRef, useState } from 'react';

// ============================================================
// useStorageRows — 사용자별 목록 조회 (작업중 / 재고 공용)
//
//   GET {endpoint}?user_id=  → { success, data: T[] }
//   · 사용자 변경 직후 이전 사용자의 늦은 응답이 덮어쓰지 않도록 요청 순번으로 무시
//     (쉽먼트 V2 useShipmentRows 와 같은 방식)
// ============================================================
export function useStorageRows<T>(endpoint: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const seqRef = useRef(0);

  const fetchRows = useCallback(async (userId: string) => {
    const seq = ++seqRef.current;
    if (!userId) {
      setRows([]);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${endpoint}?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (seq !== seqRef.current) return;
      if (!json.success) throw new Error(json.error || endpoint);
      setRows((json.data || []) as T[]);
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error(`${endpoint} 조회 오류:`, err);
      setRows([]);
      setLoadError(true);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [endpoint]);

  return { rows, loading, loadError, fetchRows };
}
