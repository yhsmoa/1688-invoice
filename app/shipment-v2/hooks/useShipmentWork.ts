'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShipmentWorkInfo } from '../types';

// ============================================================
// useShipmentWork — 그 사업자의 쉽먼트 작업 상태 (GET · POST /api/ft/shipment-work)
//
//   work = 열린 작업 (없으면 null). 작업 중에는 그 사업자의 박스에 담거나 뺄 수 없다 (supabase/shipment/004_shipment_work.sql)
//   쉽먼트 V2 (버튼 켜기 · [작업시작] / [작업취소])와 상품출고 V2 (담기 막힘 안내)가 같이 쓴다
//
//   · loaded = 이 사업자의 상태를 한 번이라도 받았다 (받기 전에는 버튼을 잠가 둔다)
//   · 사업자가 바뀐 뒤 늦게 도착한 응답은 요청 순번으로 버린다
//   · 창으로 돌아올 때(focus) 다시 받는다 — 다른 PC 에서 시작 · 끝냈을 수 있다
//   · start / cancel 은 실패하면 화면에 보일 문구를, 성공하면 null 을 돌려준다
// ============================================================

const API = '/api/ft/shipment-work';
type Action = 'start' | 'cancel';

export function useShipmentWork(userId: string) {
  const [work, setWork] = useState<ShipmentWorkInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);

  // ── 상태 다시 받기 — 성공 여부를 돌려준다 ──
  const reload = useCallback(async (): Promise<boolean> => {
    const seq = ++seqRef.current;
    if (!userId) {
      setWork(null);
      setLoaded(false);
      return false;
    }
    try {
      const res = await fetch(`${API}?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (seq !== seqRef.current) return false;
      if (!json.success) throw new Error(json.error || API);
      setWork((json.data as ShipmentWorkInfo | null) ?? null);
      setLoaded(true);
      return true;
    } catch (err) {
      if (seq !== seqRef.current) return false;
      console.error('쉽먼트 작업 상태 조회 오류:', err);
      return false;
    }
  }, [userId]);

  // ── 사업자가 바뀌면 이전 상태를 비우고 다시 받는다 ──
  useEffect(() => {
    setWork(null);
    setLoaded(false);
    reload();
  }, [reload]);

  // ── 창으로 돌아올 때 다시 받는다 — 다른 PC 에서 작업을 시작 · 끝냈을 수 있다 ──
  useEffect(() => {
    if (!userId) return undefined;
    const onFocus = () => { reload(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, reload]);

  const act = useCallback(async (action: Action, operatorName: string, fallback: string): Promise<string | null> => {
    if (!userId) return fallback;
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, user_id: userId, operator_name: operatorName }),
      });
      const json = await res.json();
      if (!json.success) {
        // 다른 창에서 먼저 시작 · 취소했을 수 있다 → 지금 상태로 맞춘다
        reload();
        return (json.error as string) || fallback;
      }
      if (seq === seqRef.current) {
        setWork((json.data as ShipmentWorkInfo | null) ?? null);
        setLoaded(true);
      }
      return null;
    } catch (err) {
      console.error('쉽먼트 작업 처리 오류:', err);
      return fallback;
    } finally {
      setBusy(false);
    }
  }, [userId, reload]);

  const start = useCallback((operatorName: string, fallback: string) => act('start', operatorName, fallback), [act]);
  const cancel = useCallback((operatorName: string, fallback: string) => act('cancel', operatorName, fallback), [act]);

  return { work, loaded, busy, reload, start, cancel };
}
