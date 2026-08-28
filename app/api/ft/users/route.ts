import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// 요청 정보를 쓰지 않는 GET 핸들러는 Next.js 가 빌드 시점에 정적 캐시한다.
// → 배포 이후 ft_users 에 추가된 사용자(다른 프로젝트의 회원가입 포함)가
//   재배포 전까지 드롭다운에 나타나지 않는 문제가 있어 매 요청 조회로 고정.
export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/users
// ft_users 테이블에서 사용자 목록 조회
// ============================================================
// 클라이언트로 내보내지 않는 민감 컬럼
const SENSITIVE = new Set(['password']);

export async function GET() {
  try {
    // select('*') — master_id 컬럼이 아직 없는 환경에서도 쿼리가 깨지지 않도록.
    // 대신 민감 컬럼은 응답에서 제거하고, master_id 는 없으면 balance_id 로 폴백한다.
    const { data, error } = await supabase
      .from('ft_users')
      .select('*')
      .order('user_code', { ascending: true });

    if (error) throw error;

    const rows = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (!SENSITIVE.has(k)) out[k] = v;
      }
      out.master_id = r.master_id ?? r.balance_id ?? null;
      return out;
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('ft_users 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_users 목록을 불러오는 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
