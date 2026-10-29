import { supabase } from './supabase';

// ============================================================
// 통관 품목 영문명 매핑 (서버 전용)
//
//   ft_order_items.customs_category 는 한글(티셔츠·바지 …)로 저장된다.
//   통관정보 표 "invoiceManager-Customs" 의 item_name_ko ↔ item_name_en 이 유일한 매핑이다.
//   (2026-10-29 기준 20행 — 1000행 limit 과 무관하지만 range 루프로 전부 읽는다)
//
//   저장값은 바꾸지 않고 화면 표시용 영문만 붙인다.
//   같은 한글이 여러 HS CODE 로 있을 수 있으나(가방 3종) 영문은 동일 → 첫 값 사용.
// ============================================================

const CUSTOMS_TABLE = 'invoiceManager-Customs';
const PAGE = 1000;

/** 한글 품목명 → 영문 품목명 */
export async function loadCustomsCategoryEnMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(CUSTOMS_TABLE)
      .select('item_name_ko, item_name_en')
      .order('HS_code', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { item_name_ko: string | null; item_name_en: string | null }[];
    for (const r of rows) {
      const ko = (r.item_name_ko ?? '').trim();
      const en = (r.item_name_en ?? '').trim();
      if (ko && en && !map.has(ko)) map.set(ko, en);
    }
    if (rows.length < PAGE) break;
  }
  return map;
}

/** 품목 한글값 → 영문 (매핑 없으면 null) */
export function toCustomsCategoryEn(
  category: string | null | undefined,
  enMap: Map<string, string>,
): string | null {
  const ko = (category ?? '').trim();
  if (!ko) return null;
  return enMap.get(ko) ?? null;
}
