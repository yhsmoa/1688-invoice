'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Worker } from '../../shipment-v2/types';
import { workerLabel } from '../../shipment-v2/hooks/useWorkers';

// ============================================================
// useRememberedWorker — 이 폰에서 고른 담당자를 기억한다 (localStorage)
//   모바일 작업 화면 공용 (/m/wow · /m/putaway) — 한 번 고르면 두 화면에 같이 쓰인다
//
//   · 저장 값 = 담당자 표시 이름 (workerLabel) — 서버에 operator_name 으로 보내는 값
//   · 담당자 목록을 받은 뒤, 기억한 이름이 목록에 없으면 지운다 (퇴사 · 역할 변경)
//   · ready = 저장소를 읽었는지. 읽기 전에는 화면을 정하지 않는다
// ============================================================

/** 저장 이름 — 처음 쓴 화면(/m/wow)의 이름 그대로 둔다 (바꾸면 폰마다 기억해 둔 담당자가 지워진다) */
const STORAGE_KEY = 'mobileWow.operatorName';

export function useRememberedWorker(workers: Worker[]) {
  const [operatorName, setOperatorName] = useState('');
  const [ready, setReady] = useState(false);

  // ── 저장 · 지우기 ──
  const choose = useCallback((name: string) => {
    setOperatorName(name);
    try {
      if (name) localStorage.setItem(STORAGE_KEY, name);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 저장소를 쓸 수 없는 브라우저 — 이번에만 쓰고 기억하지 못한다
    }
  }, []);

  // ── 처음 열 때 읽기 ──
  useEffect(() => {
    try {
      setOperatorName(localStorage.getItem(STORAGE_KEY) ?? '');
    } catch {
      // 저장소를 읽을 수 없으면 담당자를 다시 고르게 한다
    }
    setReady(true);
  }, []);

  // ── 목록에 없는 이름이면 지운다 (목록을 아직 못 받았으면 그대로 둔다) ──
  useEffect(() => {
    if (!ready || !operatorName || workers.length === 0) return;
    if (!workers.some((w) => workerLabel(w) === operatorName)) choose('');
  }, [ready, operatorName, workers, choose]);

  return { operatorName, ready, choose };
}
