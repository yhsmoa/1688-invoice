'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CopyToast from '../../../component/CopyToast';

// ============================================================
// useCopyToast — 복사 알림 표시 ({ show(message), toastNode })
//   show 를 다시 부르면 문구를 바꾸고 숨김 타이머를 처음부터 다시 잰다
//   toastNode 는 화면 아무 곳에나 한 번 그린다 (position: fixed)
// ============================================================

/** 알림이 보이는 시간 (ms) */
export const COPY_TOAST_DURATION_MS = 1500;

export function useCopyToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), COPY_TOAST_DURATION_MS);
  }, []);

  // ── 화면을 떠날 때 타이머 정리 ──
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toastNode = React.createElement(CopyToast, { message });
  return { show, toastNode };
}
