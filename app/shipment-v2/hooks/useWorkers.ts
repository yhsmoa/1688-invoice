'use client';

import { useEffect, useState } from 'react';
import type { Worker } from '../types';

// ============================================================
// useWorkers — 처리 담당자 목록 (/api/hr/workers)
//   invoiceManager_employees WHERE status='WORKING' AND role IN ('매니저','검수')
//   표시·저장 값은 상품출고 V2 와 같은 "{name} {name_kr}" 형식
// ============================================================
export const workerLabel = (w: Worker): string => [w.name, w.name_kr].filter(Boolean).join(' ');

export function useWorkers() {
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hr/workers');
        const json = await res.json();
        if (!cancelled && json.success) setWorkers(json.data || []);
      } catch (err) {
        console.error('workers 조회 오류:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return workers;
}
