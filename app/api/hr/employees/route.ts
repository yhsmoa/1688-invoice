import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/hr/employees
// 직원 전체 목록 조회
// ============================================================
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });

  } catch (error) {
    console.error('직원 목록 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '직원 목록을 불러오는 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/hr/employees
// 신규 직원 추가
// access_authorization은 항상 false로 고정 (변경 불가)
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // access_authorization, id, created_at은 제거 (서버에서 관리)
    const { access_authorization, id, created_at, code, ...rest } = body;

    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .insert({
        ...rest,
        access_authorization: false, // 항상 false 고정
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('직원 추가 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '직원 추가 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      },
      { status: 500 }
    );
  }
}
