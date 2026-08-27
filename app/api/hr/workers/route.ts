import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// 요청 정보를 쓰지 않는 GET 은 Next.js 가 빌드 시점에 정적 캐시하므로,
// 배포 이후 추가된 데이터가 재배포 전까지 반영되지 않는다 → 매 요청 조회로 고정.
export const dynamic = 'force-dynamic';

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
