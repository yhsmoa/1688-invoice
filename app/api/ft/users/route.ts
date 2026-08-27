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
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('ft_users')
      .select('id, full_name, user_code, brand, vender_name')
      .order('full_name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
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
