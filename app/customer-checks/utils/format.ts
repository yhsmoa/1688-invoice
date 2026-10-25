// ============================================================
// 고객 검수 확인 — 표시 포맷 (KST)
// ============================================================

const DATE_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  month: '2-digit', day: '2-digit',
});

/** 2026-10-25 14:03 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA 는 "2026-10-25, 14:03" 형태 → 쉼표 제거
  return DATE_TIME.format(d).replace(',', '');
}

/** 10-25 (목록용) */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_ONLY.format(d);
}

/** 상품 이미지 — 외부 CDN(Referer 차단) 은 image-proxy 경유 */
export function proxiedImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/** 상품명 + 옵션명 한 줄 */
export function itemTitle(itemName: string | null, optionName: string | null): string {
  return [itemName, optionName].filter(Boolean).join(' · ');
}

/** 중국 옵션 1·2 */
export function chinaOptions(o1: string | null, o2: string | null): string {
  return [o1, o2].filter(Boolean).join(', ');
}
