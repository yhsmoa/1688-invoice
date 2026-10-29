import { NextRequest, NextResponse } from 'next/server';
import { isDbAccessScope, verifyDbAccessCode } from '../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/db/verify-access
//
// DB 관리 메뉴(주문 데이터 관리 / 물량관리 / 데이터베이스 관리 / 무역계좌) 잠금 해제용
// 8자리 코드 검증. 조건은 lib/dbAccess.ts 참조 (access_authorization + 범위별 직책).
//   scope 생략 = 'db' ('기업' 만) / 'volume' = 물량관리 ('기업' · '매니저')
//
// 기존 /api/hr/verify-access 는 직원관리·급여장부가 사용 중이며 조건이 다르므로
// 건드리지 않고 별도 엔드포인트로 분리한다.
//
// Request : { code: string, scope?: 'db' | 'volume' }
// Response: { success: boolean, error?: string }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── 범위: 생략 시 'db', 허용 목록 밖이면 400 ──
    const scope = body?.scope ?? 'db';
    if (!isDbAccessScope(scope)) {
      return NextResponse.json({ success: false, error: '알 수 없는 접근 범위입니다.' }, { status: 400 });
    }

    const result = await verifyDbAccessCode(body?.code, scope);

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DB 관리 접근 검증 오류:', error);
    return NextResponse.json(
      { success: false, error: '검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
