import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// PUT /api/hr/employees/[id]
// 직원 정보 수정
// access_authorization, id, created_at, code는 수정 불가
// ============================================================
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: '직원 ID가 필요합니다.' },
        { status: 400 }
      );
    }

    const body = await request.json();

    // 수정 불가 필드 제거
    const { access_authorization, id: bodyId, created_at, code, ...updateFields } = body;

    // 빈 문자열("")을 전부 null로 변환 (PostgreSQL date/number 등 타입 호환)
    for (const key of Object.keys(updateFields)) {
      if (updateFields[key] === '') updateFields[key] = null;
    }

    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('직원 정보 수정 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '직원 정보 수정 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error)
      },
      { status: 500 }
    );
  }
}
