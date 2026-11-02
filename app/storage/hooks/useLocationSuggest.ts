'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LocationSuggestion } from '../types';

// ============================================================
// useLocationSuggest — 배치 모달의 추천 위치 칩
//   GET /api/ft/storage/suggest (같은 바코드 → 같은 offer_id → 없음)
//   reload: 배치 직후 다시 읽어 방금 넣은 칸이 칩에 나타나게
// ============================================================
export function useLocationSuggest(userId: string, productId: string | null) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);

  const reload = useCallback(async () => {
    if (!userId || !productId) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/ft/storage/suggest?user_id=${encodeURIComponent(userId)}&product_id=${encodeURIComponent(productId)}`,
        { cache: 'no-store' }
      );
      const json = await res.json();
      setSuggestions(json.success ? (json.data as LocationSuggestion[]) : []);
    } catch (err) {
      console.error('추천 위치 조회 오류:', err);
      setSuggestions([]);
    }
  }, [userId, productId]);

  useEffect(() => { reload(); }, [reload]);

  return { suggestions, reload };
}
