import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ============================================================
// QZ Tray 서명용 공개 인증서 — GET /api/qz/cert
//
// 브라우저의 qz-tray.js 가 연결 직후 이 인증서를 QZ Tray 에 제시한다.
// 인쇄 PC 의 QZ Tray 가 같은 인증서를 override.crt 로 신뢰하고 있으면
// "익명 요청" 허용 창이 뜨지 않는다.
//
// 공개 인증서라 노출돼도 문제없다. 개인키(QZ_PRIVATE_KEY)는 /api/qz/sign 만 쓴다.
// 환경변수가 없으면 404 → 클라이언트는 익명 모드로 동작(허용 창이 뜸).
//
// ?download=1 이면 override.crt 파일로 내려준다 (인쇄 PC 에 복사용).
// ============================================================

/** env 의 \n 이스케이프를 실제 개행으로 (GOOGLE_PRIVATE_KEY 와 같은 규칙) */
function readPem(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  return raw.replace(/\\n/g, '\n').trim();
}

export async function GET(request: Request) {
  const cert = readPem('QZ_CERTIFICATE');
  if (!cert) {
    return new NextResponse('QZ_CERTIFICATE 가 설정되지 않았습니다.', { status: 404 });
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  return new NextResponse(cert + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'application/x-pem-file; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(download ? { 'Content-Disposition': 'attachment; filename="override.crt"' } : {}),
    },
  });
}
