import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/debug/whichdb
// 진단 전용(비파괴) — 이 서버 인스턴스가 런타임에 실제로 어떤
// Supabase 프로젝트에 연결되는지 확인.
//
// 반환값에 비밀키는 포함하지 않는다:
//   - SUPABASE_URL 은 호스트만
//   - SERVICE_ROLE_KEY / ANON_KEY 는 JWT payload 의 project ref 만 디코드
//     (ref 는 공개 식별자 — 대시보드 URL 에도 노출됨)
// ============================================================

/** JWT payload 의 ref 만 안전하게 추출 (서명 검증 없이 base64 디코드) */
function jwtRef(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload, 'base64').toString('utf8');
    const obj = JSON.parse(json) as { ref?: string };
    return obj.ref ?? null;
  } catch {
    return null;
  }
}

/** URL 에서 호스트만 (키 노출 방지) */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    // 서버(API)가 쓰는 값
    supabase_url_host: hostOf(process.env.SUPABASE_URL),
    service_role_key_ref: jwtRef(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // 브라우저(프론트)가 쓰는 값
    next_public_supabase_url_host: hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anon_key_ref: jwtRef(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    // 참고
    stock_supabase_url_host: hostOf(process.env.STOCK_SUPABASE_URL),
  });
}
