import { NextRequest, NextResponse } from 'next/server';
import { supabase } from './supabase';

// ============================================================
// DB 관리 메뉴 접근 권한 검증 (서버 전용)
//
//   접근 범위(scope) 별 통과 조건 — 둘 다 만족해야 통과
//     1. invoiceManager_employees.code 일치
//     2. access_authorization = true  AND  role ∈ DB_ACCESS_ROLES[scope]
//
//   scope
//     · 'db'     (기본) : /db/orders, /db/database, /db/order-inspect, 무역계좌
//                         → 직책 '기업' 만 (현재 YUHWA 1명)
//     · 'volume'        : /db/volume (물량관리) + 그 데이터 API
//                         → 직책 '기업' · '매니저'
//
//   직책·권한 플래그는 모두 DB 값이므로 코드에 이름·ID 를 하드코딩하지 않는다.
//   (access_authorization 은 직원관리 화면에서 바꿀 수 없는 관리자 전용 플래그)
//
//   화면 잠금만으로는 API 직접 호출을 막을 수 없으므로,
//   /api/db/* 라우트는 반드시 guardDbRoute() 로 먼저 검증한다.
// ============================================================

/** 클라이언트가 접근 코드를 실어 보내는 요청 헤더명 */
export const DB_ACCESS_HEADER = 'x-db-access-code';

// ============================================================
// 접근 범위 / 범위별 허용 직책
// ============================================================
export const DB_ACCESS_SCOPES = ['db', 'volume'] as const;
export type DbAccessScope = (typeof DB_ACCESS_SCOPES)[number];

const DB_ACCESS_ROLES: Record<DbAccessScope, readonly string[]> = {
  db: ['기업'],
  volume: ['기업', '매니저'],
};

const DB_ACCESS_DENIED_MESSAGE: Record<DbAccessScope, string> = {
  db: 'DB 관리 메뉴 접근 권한이 없습니다.',
  volume: '물량관리 접근 권한이 없습니다.',
};

/** 문자열이 허용된 scope 인지 (요청 body 검증용) */
export const isDbAccessScope = (v: unknown): v is DbAccessScope =>
  typeof v === 'string' && (DB_ACCESS_SCOPES as readonly string[]).includes(v);

export interface DbAccessResult {
  ok: boolean;
  status: number;
  error?: string;
  /** 통과한 직원 id — 기록 주체(created_by) 표시용 */
  employeeId?: string;
}

/**
 * 접근 코드 검증.
 * 코드 자체를 매 요청 재검증하므로, 권한을 회수하면 즉시 반영된다.
 *   401 = 코드 자체가 틀림 / 403 = 코드는 맞지만 이 범위 권한 없음
 */
export async function verifyDbAccessCode(
  code: string | null | undefined,
  scope: DbAccessScope = 'db',
): Promise<DbAccessResult> {
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

  if (!data.access_authorization || !DB_ACCESS_ROLES[scope].includes(data.role ?? '')) {
    return { ok: false, status: 403, error: DB_ACCESS_DENIED_MESSAGE[scope] };
  }

  return { ok: true, status: 200, employeeId: data.id as string };
}

/**
 * guardDbRoute 와 같은 검증이지만 통과 시 직원 id 를 돌려준다.
 * 기록을 남기는 라우트(무역계좌 등)가 created_by 에 쓴다.
 *
 *   const access = await requireDbAccess(request);
 *   if (!access.ok) return access.response;
 *   … access.employeeId …
 */
export async function requireDbAccess(
  request: NextRequest,
  scope: DbAccessScope = 'db',
): Promise<{ ok: true; employeeId: string } | { ok: false; response: NextResponse }> {
  const result = await verifyDbAccessCode(request.headers.get(DB_ACCESS_HEADER), scope);
  if (result.ok && result.employeeId) return { ok: true, employeeId: result.employeeId };
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: result.error ?? '접근 권한이 없습니다.' }, { status: result.status }),
  };
}

/**
 * /api/db/* 라우트 가드.
 * 통과하면 null, 실패하면 그대로 반환할 에러 응답을 돌려준다.
 *
 *   const denied = await guardDbRoute(request);            // 'db' 범위
 *   const denied = await guardDbRoute(request, 'volume');  // 물량관리
 *   if (denied) return denied;
 */
export async function guardDbRoute(
  request: NextRequest,
  scope: DbAccessScope = 'db',
): Promise<NextResponse | null> {
  const result = await verifyDbAccessCode(request.headers.get(DB_ACCESS_HEADER), scope);
  if (result.ok) return null;
  return NextResponse.json({ success: false, error: result.error }, { status: result.status });
}
