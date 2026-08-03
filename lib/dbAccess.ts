import { NextRequest, NextResponse } from 'next/server';
import { supabase } from './supabase';

// ============================================================
// DB 관리 메뉴 접근 권한 검증 (서버 전용)
//
//   대상 페이지: /db/orders, /db/volume, /db/database
//
//   통과 조건 (둘 다 만족)
//     1. invoiceManager_employees.code 일치
//     2. access_authorization = true  AND  role = '기업'
//
//   → 현재 '기업' 직책은 YUHWA(유화무역) 1명. 직책은 직원관리 화면에서
//     수정 가능하므로 코드에 이름·ID 를 하드코딩하지 않는다.
//
//   화면 잠금만으로는 API 직접 호출을 막을 수 없으므로,
//   /api/db/* 라우트는 반드시 guardDbRoute() 로 먼저 검증한다.
// ============================================================

/** 클라이언트가 접근 코드를 실어 보내는 요청 헤더명 */
export const DB_ACCESS_HEADER = 'x-db-access-code';

/** DB 관리 메뉴를 볼 수 있는 직책 */
const DB_ACCESS_ROLE = '기업';

export interface DbAccessResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * 접근 코드 검증.
 * 코드 자체를 매 요청 재검증하므로, 권한을 회수하면 즉시 반영된다.
 */
export async function verifyDbAccessCode(code: string | null | undefined): Promise<DbAccessResult> {
  const trimmed = (code ?? '').trim();

  if (!trimmed) {
    return { ok: false, status: 401, error: '접근 코드가 필요합니다.' };
  }

  const { data, error } = await supabase
    .from('invoiceManager_employees')
    .select('id, role, access_authorization')
    .eq('code', trimmed)
    .maybeSingle();

  if (error) {
    console.error('DB 관리 접근 코드 검증 오류:', error);
    return { ok: false, status: 500, error: '검증 중 오류가 발생했습니다.' };
  }

  if (!data) {
    return { ok: false, status: 401, error: '코드가 일치하는 직원이 없습니다.' };
  }

  if (!data.access_authorization || data.role !== DB_ACCESS_ROLE) {
    return { ok: false, status: 403, error: 'DB 관리 메뉴 접근 권한이 없습니다.' };
  }

  return { ok: true, status: 200 };
}

/**
 * /api/db/* 라우트 가드.
 * 통과하면 null, 실패하면 그대로 반환할 에러 응답을 돌려준다.
 *
 *   const denied = await guardDbRoute(request);
 *   if (denied) return denied;
 */
export async function guardDbRoute(request: NextRequest): Promise<NextResponse | null> {
  const result = await verifyDbAccessCode(request.headers.get(DB_ACCESS_HEADER));
  if (result.ok) return null;
  return NextResponse.json({ success: false, error: result.error }, { status: result.status });
}
