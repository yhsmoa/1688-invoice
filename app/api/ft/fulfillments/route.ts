import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/ft/fulfillments
// ft_fulfillments 테이블에 입고(ARRIVAL) 데이터 일괄 저장
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items } = body;

    // ============================================================
    // 1. 입력 데이터 검증
    // ============================================================
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // ============================================================
    // 2. Supabase INSERT (일괄)
    // ============================================================
    const { data, error } = await supabase
      .from('ft_fulfillments')
      .insert(items)
      .select('id');

    if (error) throw error;

    console.log(`ft_fulfillments 저장 완료: ${data?.length ?? 0}개`);

    return NextResponse.json({
      success: true,
      count: data?.length ?? 0,
      message: `${data?.length ?? 0}개 데이터가 저장되었습니다.`,
    });
  } catch (error) {
    console.error('ft_fulfillments 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
