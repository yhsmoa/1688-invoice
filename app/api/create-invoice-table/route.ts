import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('테이블 생성 API 호출');
    
    // 테이블 존재 여부 확인
    const { error: tableCheckError } = await supabase
      .from('invoice_import_googlesheet')
      .select('row_id')
      .limit(1);
    
    // 테이블이 이미 존재하면 메시지 반환
    if (!tableCheckError) {
      console.log('테이블이 이미 존재합니다.');
      return NextResponse.json({ 
        success: true,
        message: 'invoice_import_googlesheet 테이블이 이미 존재합니다.' 
      });
    }
    
    console.log('테이블이 존재하지 않습니다. SQL을 반환합니다.');
    
    // 테이블 생성 SQL
    const createTableSQL = `
    CREATE TABLE public.invoice_import_googlesheet (
      row_id text PRIMARY KEY,
      order_number text NOT NULL,
      date text NULL,
      product_name text NULL,
      option_name text NULL,
      barcode text NULL,
      china_option1 text NULL,
      china_option2 text NULL,
      price numeric NULL,
      total_price numeric NULL,
      img_url text NULL,
      site_url text NULL,
      ordered_qty integer NULL,
      import_qty integer NULL,
      cancel_qty integer NULL,
      export_qty integer NULL,
      "1688_order_number" text NULL,
      offer_id text NULL,
      order_qty integer NULL
    );
    `;
    
    // SQL을 반환
    return NextResponse.json({ 
      error: '테이블이 존재하지 않습니다. Supabase 대시보드에서 다음 SQL을 실행하세요.',
      sql: createTableSQL
    }, { status: 500 });
  } catch (error) {
    console.error('테이블 생성 API 호출 중 예외 발생:', error);
    return NextResponse.json({ 
      error: '테이블 생성 API 호출 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 