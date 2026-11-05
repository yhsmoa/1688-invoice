import { gzipSync } from 'zlib';
import { NextResponse } from 'next/server';

// ============================================================
// 큰 JSON 응답 gzip — App Router 라우트 핸들러 응답은 Next 의 compress 가 압축하지 않는다
//
//   2026-11-05 운영 측정: /api/ft/order-items 가 2.1MB 를 그대로 보냈다 (HTML 은 gzip 됨).
//   JSON 은 키가 반복돼 gzip 으로 보통 1/8 이하로 줄어든다. 브라우저 fetch 는 자동으로 푼다.
//   Accept-Encoding 에 gzip 이 없거나 본문이 작으면 그대로 보낸다.
// ============================================================

const MIN_GZIP_BYTES = 1024;

export function jsonResponse(request: Request, payload: unknown, status = 200): NextResponse {
  const body = JSON.stringify(payload);
  const acceptsGzip = /\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '');
  if (!acceptsGzip || body.length < MIN_GZIP_BYTES) {
    return new NextResponse(body, {
      status,
      headers: { 'Content-Type': 'application/json', Vary: 'Accept-Encoding' },
    });
  }
  const gz = gzipSync(Buffer.from(body, 'utf8'));
  return new NextResponse(new Uint8Array(gz), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(gz.length),
      Vary: 'Accept-Encoding',
    },
  });
}
