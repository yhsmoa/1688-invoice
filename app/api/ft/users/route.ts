import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

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
