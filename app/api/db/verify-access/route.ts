import { NextRequest, NextResponse } from 'next/server';
import { verifyDbAccessCode } from '../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/db/verify-access
//
// DB 관리 메뉴(주문 데이터 관리 / 물량관리 / 데이터베이스 관리) 잠금 해제용
// 8자리 코드 검증. 조건은 lib/dbAccess.ts 참조 (access_authorization + role='기업').
//
// 기존 /api/hr/verify-access 는 직원관리·급여장부가 사용 중이며 조건이 다르므로
// 건드리지 않고 별도 엔드포인트로 분리한다.
//
// Request : { code: string }
// Response: { success: boolean, error?: string }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await verifyDbAccessCode(body?.code);

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
