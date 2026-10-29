'use client';

import { useEffect, useMemo, useState } from 'react';

// ============================================================
// useCustomsOptions — 통관 품목 목록 (/api/get-customs-data → invoiceManager-Customs)
//
//   저장 키는 한글(item_name_ko, ft_order_items.customs_category 와 같은 값),
//   화면 표시는 영문(item_name_en). 같은 한글이 HS CODE 별로 여러 행(가방 3종)이라 한글 기준 1개.
//   품목 편집 드롭다운(ShipmentTableRow)과 [생성] 모달이 같이 쓴다.
// ============================================================
export interface CustomsOption {
  /** 저장 키 (한글) */
  ko: string;
  /** 표시 (영문, 없으면 한글) */
  en: string;
}

export function useCustomsOptions() {
  const [options, setOptions] = useState<CustomsOption[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/get-customs-data');
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || 'customs');
        const map = new Map<string, string>();
        for (const r of (json.data || []) as { item_name_ko?: string | null; item_name_en?: string | null }[]) {
          const ko = (r.item_name_ko || '').trim();
          if (ko && !map.has(ko)) map.set(ko, (r.item_name_en || '').trim() || ko);
        }
        setOptions(
          Array.from(map.entries())
            .map(([ko, en]) => ({ ko, en }))
            .sort((a, b) => a.en.localeCompare(b.en))
        );
      } catch (err) {
        if (!cancelled) {
          console.error('통관 품목 조회 오류:', err);
          setLoadError(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** 한글 키 → 영문 */
  const enByKo = useMemo(() => new Map(options.map((o) => [o.ko, o.en])), [options]);

  return { options, enByKo, loadError };
}
