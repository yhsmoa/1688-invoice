import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// GET /api/image-proxy?url=…&w=…
//
//   외부 CDN 이미지를 Referer 를 붙여 대신 받아 준다 (alicdn 은 Referer 없으면 차단).
//
//   w (선택) — 썸네일 폭. alicdn 계열 .jpg/.png 는 URL 뒤에 `_{w}x{w}.jpg` 를 붙이면
//   CDN 이 리사이즈한 변형을 준다 (원본 500KB → 160px 11KB). 변형 요청이 실패(비 2xx)하면
//   원본을 받아서 돌려주므로 화면에서 이미지가 빠지는 일은 없다.
//   그 외 호스트·확장자는 w 를 무시하고 원본을 준다.
//
//   응답은 1년 캐시 (URL 이 바뀌면 다른 리소스).
// ============================================================

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Referer: 'https://www.1688.com/',
  Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** 리사이즈 변형(_WxH.jpg)을 지원하는 CDN 호스트 */
const RESIZABLE_HOST_RE = /(^|\.)alicdn\.com$/i;
/** 변형을 붙일 수 있는 원본 확장자 (이미 변형이 붙은 …jpg_q30.jpg_.webp 같은 건 제외) */
const RESIZABLE_PATH_RE = /\.(jpe?g|png)$/i;
/** 허용 폭 — 임의 값으로 CDN 캐시를 흩뜨리지 않게 고정 단계만 */
const ALLOWED_WIDTHS = new Set([80, 160, 240, 320, 480]);

function resizedVariant(imageUrl: string, width: number | null): string | null {
  if (!width || !ALLOWED_WIDTHS.has(width)) return null;
  try {
    const u = new URL(imageUrl);
    if (!RESIZABLE_HOST_RE.test(u.hostname)) return null;
    if (!RESIZABLE_PATH_RE.test(u.pathname)) return null;
    return `${imageUrl}_${width}x${width}.jpg`;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const imageUrl = searchParams.get('url');
    const widthParam = searchParams.get('w');
    const width = widthParam ? parseInt(widthParam, 10) || null : null;

    if (!imageUrl) {
      return new NextResponse('Image URL is required', { status: 400 });
    }

    // ── 1) 썸네일 변형 먼저 (가능한 경우) ──
    let response: Response | null = null;
    const variant = resizedVariant(imageUrl, width);
    if (variant) {
      try {
        const r = await fetch(variant, { headers: FETCH_HEADERS });
        if (r.ok) response = r;
      } catch {
        // 변형 실패 → 아래에서 원본
      }
    }

    // ── 2) 원본 ──
    if (!response) {
      response = await fetch(imageUrl, { headers: FETCH_HEADERS });
      if (!response.ok) {
        console.error('Failed to fetch image:', imageUrl, 'Status:', response.status, response.statusText);
        return new NextResponse('Failed to fetch image', { status: response.status });
      }
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageBuffer = await response.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
