'use client';

import { useEffect, useState } from 'react';

// ============================================================
// Worker 목록 — invoiceManager_employees (status='WORKING' AND role IN ('매니저','검수'))
//   /api/hr/workers 를 마운트 시 1회 조회한다.
//   상품입고 V2 · V3 공용 (드롭박스 값 = `${name} ${name_kr}` → operator_name 으로 저장)
// ============================================================

export interface Worker {
  id: string;
  name: string;
  name_kr: string;
  role: string;
}

/** PC-NO 옵션 (라벨 프린터 자리 번호 — 인쇄 기록·BarTender operator_no) */
export const PC_NO_OPTIONS = [1, 2, 3, 4];

export function useWorkers(): Worker[] {
  const [workers, setWorkers] = useState<Worker[]>([]);

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

  return workers;
}
