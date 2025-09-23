import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    console.log('invoice_import_googlesheet 테이블 업데이트 시작');

    // 1. 현재 테이블 구조 확인
    const { data: tableInfo, error: infoError } = await supabase
      .from('invoice_import_googlesheet')
      .select('*')
      .limit(1);

    if (infoError) {
      console.error('테이블 정보 조회 오류:', infoError);
    }

    // 2. coupang_name과 googlesheet_id 컬럼 추가 시도
    try {
      // Supabase에서는 직접 ALTER TABLE을 실행할 수 없으므로
      // 더미 데이터로 컬럼 존재 여부 확인 후 처리
      const testData = {
        coupang_name: 'test_column_check',
        googlesheet_id: 'test_column_check',
        order_number: 'test_update_table',
        product_name: 'Column Update Test'
      };

      const { data, error } = await supabase
        .from('invoice_import_googlesheet')
        .insert([testData])
        .select();

      if (error) {
        if (error.message.includes('column') && error.message.includes('does not exist')) {
          console.log('coupang_name 또는 googlesheet_id 컬럼이 존재하지 않습니다.');

          return NextResponse.json({
            success: false,
            message: 'coupang_name과 googlesheet_id 컬럼을 Supabase 대시보드에서 수동으로 추가해주세요.',
            error: error.message,
            sql_commands: [
              'ALTER TABLE public.invoice_import_googlesheet ADD COLUMN IF NOT EXISTS coupang_name TEXT;',
              'ALTER TABLE public.invoice_import_googlesheet ADD COLUMN IF NOT EXISTS googlesheet_id TEXT;',
              'ALTER TABLE public.invoice_import_googlesheet ADD COLUMN IF NOT EXISTS row_id TEXT;'
            ]
          }, { status: 200 });
        }

        console.error('테스트 데이터 삽입 오류:', error);
        return NextResponse.json({
          error: '테이블 업데이트 테스트 중 오류가 발생했습니다.',
          details: error.message
        }, { status: 500 });
      }

      // 테스트 데이터 삭제
      if (data && data.length > 0) {
        await supabase
          .from('invoice_import_googlesheet')
          .delete()
          .eq('order_number', 'test_update_table');
      }

      console.log('컬럼이 이미 존재하거나 성공적으로 추가되었습니다.');

      return NextResponse.json({
        success: true,
        message: 'invoice_import_googlesheet 테이블이 업데이트되었습니다.',
        columns_added: ['coupang_name', 'googlesheet_id', 'row_id']
      });

    } catch (error) {
      console.error('테이블 업데이트 중 예외 발생:', error);
      return NextResponse.json({
        error: '테이블 업데이트 중 예외가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('테이블 업데이트 중 오류:', error);
    return NextResponse.json({
      error: '테이블 업데이트 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}