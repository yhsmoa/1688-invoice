import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const { barcodeData } = await request.json();

    if (!barcodeData || !Array.isArray(barcodeData)) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 데이터입니다.' },
        { status: 400 }
      );
    }

    // Supabase에 데이터 저장
    const { data, error } = await supabase
      .from('invoiceManager-label')
      .insert(barcodeData)
      .select();

    if (error) {
      console.error('Supabase 저장 오류:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      data: data
    });

  } catch (error: any) {
    console.error('API 오류:', error);
    return NextResponse.json(
      { success: false, error: error.message || '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
