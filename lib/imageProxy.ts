// ============================================================
// 상품 이미지 프록시 URL — /api/image-proxy
//
//   외부 CDN(alicdn, Referer 차단)은 프록시를 거쳐야 보인다. 화면의 썸네일(40~120px)에
//   원본(보통 800×800, 300~500KB)을 그대로 쓰면 행 20개에 10MB 가까이 내려받으므로
//   `width` 를 주면 프록시가 CDN 의 리사이즈 변형(…jpg_160x160.jpg, 10KB 안팎)을 대신 가져온다.
//   변형이 없는 CDN 이거나 변형 요청이 실패하면 프록시가 원본으로 되돌아간다 (화면에서 빠지는 일 없음).
//
//   · 썸네일           : proxyImageUrl(url, THUMB_WIDTH)
//   · 확대 미리보기·인쇄 : proxyImageUrl(url)  (원본)
// ============================================================

/** 썸네일 변형 폭 — 표시 40~120px 를 고해상도(2x) 화면에서도 또렷하게 */
export const THUMB_WIDTH = 160;

/** 큰 썸네일 (V1 처리준비 120px 등) */
export const THUMB_WIDTH_LARGE = 240;

export function proxyImageUrl(url: string, width?: number): string {
  const base = `/api/image-proxy?url=${encodeURIComponent(url)}`;
  return width ? `${base}&w=${width}` : base;
}
