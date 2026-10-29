'use client';

import { useCallback, useRef, useState } from 'react';
import type { ShipmentV2Row } from '../types';

// ============================================================
// useShipmentRows — GET /api/ft/shipment-v2 (미출고 PACKED 행) 조회
//
//   · 사용자 변경 직후 이전 사용자의 늦은 응답이 덮어쓰지 않도록 요청 순번으로 무시
//   · setRows 는 로컬 패치용 (품목 편집, 박스 사이즈 수정, 이동요청 처리완료)
// ============================================================
export function useShipmentRows() {
  const [rows, setRows] = useState<ShipmentV2Row[]>([]);
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
      const res = await fetch(`/api/ft/shipment-v2?user_id=${encodeURIComponent(userId)}`);
      const json = await res.json();
      if (seq !== seqRef.current) return;
      if (!json.success) throw new Error(json.error || 'shipment-v2');
      setRows((json.data || []) as ShipmentV2Row[]);
    } catch (err) {
      if (seq !== seqRef.current) return;
      console.error('shipment-v2 fetch error:', err);
      setRows([]);
      setLoadError(true);
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  return { rows, setRows, loading, loadError, fetchRows };
}
