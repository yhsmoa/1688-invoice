import type { TFunction } from 'i18next';

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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 2026-10-25 14:03 */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA 는 "2026-10-25, 14:03" 형태 → 쉼표 제거
  return DATE_TIME.format(d).replace(',', '');
}

/** 상대 시각 — 방금 · N분 전 · N시간 전 · N일 전, 7일 넘으면 10-25 */
export function fmtAgo(iso: string | null | undefined, t: TFunction): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < MINUTE) return t('customerChecks.ago.justNow');
  if (diff < HOUR) return t('customerChecks.ago.minutes', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('customerChecks.ago.hours', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('customerChecks.ago.days', { count: Math.floor(diff / DAY) });
  return DATE_ONLY.format(d);
}

/** 상품 이미지 — 외부 CDN(Referer 차단) 은 image-proxy 경유 */
export function proxiedImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

/** 중국 옵션 1·2 */
export function chinaOptions(o1: string | null, o2: string | null): string {
  return [o1, o2].filter(Boolean).join(', ');
}
