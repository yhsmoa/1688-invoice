import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    console.log('테이블 생성 API 호출');
    
    // 테이블 존재 여부 확인
    const { error: tableCheckError } = await supabase
      .from('invoice_import_googlesheet')
      .select('id')
      .limit(1);
    
    // 테이블이 이미 존재하면 메시지 반환
    if (!tableCheckError) {
      console.log('테이블이 이미 존재합니다.');
      return NextResponse.json({ 
        message: 'invoice_import_googlesheet 테이블이 이미 존재합니다.' 
      });
    }
    
    // 테이블 생성 SQL 실행
    try {
      // Supabase REST API를 통해 테이블 생성 시도
      // 빈 데이터로 테이블 생성 시도
      const testData = {
        order_number: 'test_create_table',
        product_name: 'Table Creation Test'
      };
      
      const { data, error } = await supabase
        .from('invoice_import_googlesheet')
        .insert([testData]);
      
      if (error && !error.message.includes('does not exist')) {
        console.error('테이블 생성 시도 중 오류:', error);
        return NextResponse.json({ 
          error: 'invoice_import_googlesheet 테이블 생성에 실패했습니다.',
          details: error.message,
          sql: `
CREATE TABLE IF NOT EXISTS public.invoice_import_googlesheet (
  id SERIAL PRIMARY KEY,
  order_number text NOT NULL,
  date date NULL,
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
);`
        }, { status: 500 });
      }
      
      console.log('테이블 생성 시도 완료');
      
      // 테이블 생성 확인
      const { error: checkError } = await supabase
        .from('invoice_import_googlesheet')
        .select('id')
        .limit(1);
      
      if (checkError) {
        console.error('테이블 생성 확인 오류:', checkError);
        return NextResponse.json({ 
          error: '테이블이 성공적으로 생성되지 않았습니다.',
          details: checkError.message
        }, { status: 500 });
      }
    } catch (error) {
      console.error('테이블 생성 중 예외 발생:', error);
      return NextResponse.json({ 
        error: '테이블 생성 중 예외가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      }, { status: 500 });
    }
    
    console.log('테이블이 성공적으로 생성되었습니다.');
    return NextResponse.json({ 
      success: true, 
      message: 'invoice_import_googlesheet 테이블이 성공적으로 생성되었습니다.' 
    });
  } catch (error) {
    console.error('테이블 생성 중 예외 발생:', error);
    return NextResponse.json({ 
      error: '테이블 생성 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 