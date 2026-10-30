import { useCallback, useEffect, useState } from 'react';
import { dbAccessHeaders } from '../../../../component/DbAccessGate';
import type { PipelineData, VolumeForecastResponse } from '../../../../lib/volumeForecast';

// ============================================================
// useVolumeForecast — GET /api/db/volume-forecast 조회
//   입력값(인원·근무시간·처리속도)은 화면에서 계산만 바꾸므로 재조회하지 않는다.
//   reload 는 [새로고침] 버튼용.
// ============================================================

export function useVolumeForecast() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/db/volume-forecast', { headers: dbAccessHeaders() });
      const json: VolumeForecastResponse = await res.json();
      if (signal.cancelled) return;
      if (!json.success || !json.data) throw new Error(json.error || '조회 실패');
      setData(json.data);
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.');
      setData(null);
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, []);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
  }, [load, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, loading, error, reload };
}
