import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(req: NextRequest) {
  try {
    // invoiceManager-Customs 테이블에서 모든 데이터 가져오기
    const { data, error } = await supabase
      .from('invoiceManager-Customs')
      .select('HS_code, item_name_ko, item_name_en, CO')
      .order('HS_code', { ascending: true });

    if (error) {
      console.error('Supabase 조회 오류:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
    });
  } catch (error: any) {
    console.error('통관정보 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: error.message || '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
