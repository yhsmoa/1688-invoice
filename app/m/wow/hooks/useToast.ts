'use client';

import { useCallback, useEffect, useState } from 'react';

// ============================================================
// useToast — 화면 아래에 잠깐 떴다 사라지는 안내
//   같은 문구를 연달아 띄워도 시간이 새로 시작되도록 번호(seq)를 같이 둔다
// ============================================================

/** 안내가 떠 있는 시간 */
const TOAST_MS = 2600;

interface ToastState {
  text: string;
  seq: number;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((text: string) => {
    if (!text) return;
    setToast((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  return { toastText: toast?.text ?? null, notify };
}
