import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/hr/workers
//
// invoiceManager_employees 에서 현재 근무 중인 매니저/검수 직원 목록 조회
// 조건: status = 'WORKING' AND role IN ('매니저', '검수')
// ============================================================
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('invoiceManager_employees')
      .select('id, name, name_kr, role')
      .eq('status', 'WORKING')
      .in('role', ['매니저', '검수'])
      .order('name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('workers 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
