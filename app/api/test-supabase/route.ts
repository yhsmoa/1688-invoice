import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET() {
  try {
    console.log('=== Supabase 연결 테스트 시작 ===');
    
    // 환경변수 확인
    console.log('SUPABASE_URL:', !!process.env.SUPABASE_URL);
    console.log('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // 테이블 존재 여부 확인
    const { data, error } = await supabase
      .from('1688_invoice')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('Supabase 테스트 오류:', error);
      return NextResponse.json({
        success: false,
        error: error.message,
        details: error,
        envCheck: {
          SUPABASE_URL: !!process.env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      }, { status: 500 });
    }
    
    console.log('✅ Supabase 연결 성공');
    
    return NextResponse.json({
      success: true,
      message: 'Supabase 연결 성공',
      tableExists: true,
      recordCount: data || 0,
      envCheck: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
    
  } catch (error) {
    console.error('Supabase 테스트 예외:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      envCheck: {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    }, { status: 500 });
  }
} 