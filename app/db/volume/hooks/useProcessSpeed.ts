import { useCallback, useEffect, useState } from 'react';
import { dbAccessHeaders } from '../../../../component/DbAccessGate';
import type { ProcessSpeedResponse, SpeedPeriod } from '../../../../lib/processSpeed';
import type { Period } from '../utils/periodLabel';

// ============================================================
// useProcessSpeed — GET /api/db/process-speed 조회
//   period / basis 가 바뀌면 재조회. 세트구분·사이즈 선택은 응답 안에 이미
//   모든 조합이 있으므로 재조회하지 않는다 (화면에서 선택만).
// ============================================================

export type SpeedBasis = 'shipment' | 'confirmed';

export function useProcessSpeed(period: Period, basis: SpeedBasis) {
  const [periods, setPeriods] = useState<SpeedPeriod[]>([]);
  const [lastDeliveryUploadAt, setLastDeliveryUploadAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period, b: SpeedBasis, signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/db/process-speed?period=${p}&basis=${b}`, {
        headers: dbAccessHeaders(),
      });
      const json: ProcessSpeedResponse = await res.json();
      if (signal.cancelled) return;
      if (!json.success) throw new Error(json.error || '조회 실패');
      setPeriods(json.periods || []);
      setLastDeliveryUploadAt(json.meta?.lastDeliveryUploadAt ?? null);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.');
      setPeriods([]);
      setLastDeliveryUploadAt(null);
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 토글을 빠르게 바꿀 때 늦게 도착한 이전 응답이 덮어쓰지 않도록
    const signal = { cancelled: false };
    load(period, basis, signal);
    return () => { signal.cancelled = true; };
  }, [period, basis, load]);

  return { periods, lastDeliveryUploadAt, loading, error };
}
