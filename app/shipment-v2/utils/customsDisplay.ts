// ============================================================
// 쉽먼트 V2 — 품목(통관 품명) 표시 규칙
//
//   저장값은 한글(customs_category) 그대로 두고 화면에만 영문을 보인다.
//     · 비어 있음                         → empty   ('-' / 미분류)
//     · '알 수 없음' 포함 (오염값 포함)   → unknown (빨간 ❓, title 로 원문)
//     · 통관정보 영문 매핑 있음           → en      ('T SHIRT')
//     · 매핑 없는 한글 ('모자' 등)        → unmapped (한글 + 미등록 점)
// ============================================================

/** Gemini 분류가 판단 못 했을 때 저장하는 값 (classify-products 프롬프트 규칙 4) */
const UNKNOWN_MARKERS = ['알 수 없음', '알수없음'];

export type CategoryDisplay =
  | { kind: 'empty' }
  | { kind: 'unknown'; raw: string }
  | { kind: 'en'; text: string; raw: string }
  | { kind: 'unmapped'; raw: string };

export function getCategoryDisplay(
  raw: string | null | undefined,
  en: string | null | undefined,
): CategoryDisplay {
  const value = (raw ?? '').trim();
  if (!value) return { kind: 'empty' };
  if (UNKNOWN_MARKERS.some((m) => value.includes(m))) return { kind: 'unknown', raw: value };
  if (en) return { kind: 'en', text: en, raw: value };
  return { kind: 'unmapped', raw: value };
}
