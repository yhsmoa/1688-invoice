import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const masterAccount = searchParams.get('master_account');

    if (!masterAccount) {
      return NextResponse.json({
        success: false,
        error: 'master_account 파라미터가 필요합니다.'
      }, { status: 400 });
    }

    console.log('잔액 조회 요청 - master_account:', masterAccount);

    // invoiceManager_balance 테이블에서 balance 조회
    const { data, error } = await supabase
      .from('invoiceManager_balance')
      .select('balance')
      .eq('master_account', masterAccount)
      .single();

    if (error) {
      console.error('잔액 조회 오류:', error);
      return NextResponse.json({
        success: false,
        error: '잔액을 조회하는데 실패했습니다.',
        details: error
      }, { status: 500 });
    }

    console.log('잔액 조회 결과:', data);

    return NextResponse.json({
      success: true,
      balance: data?.balance || 0
    });
  } catch (error) {
    console.error('잔액 조회 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '잔액 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
