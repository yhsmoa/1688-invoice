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

    console.log('라이브 잔액 조회 요청 - master_account:', masterAccount);

    // 1. invoiceManager_transactions 테이블에서 트랜잭션 조회
    const { data: transactionsData, error: transactionsError } = await supabase
      .from('invoiceManager_transactions')
      .select('transaction_type, amount')
      .eq('master_account', masterAccount);

    if (transactionsError) {
      console.error('트랜잭션 조회 오류:', transactionsError);
      return NextResponse.json({
        success: false,
        error: '트랜잭션을 조회하는데 실패했습니다.',
        details: transactionsError
      }, { status: 500 });
    }

    // 2. invoiceManager_refundOrder 테이블에서 환불금액 조회
    const { data: refundData, error: refundError } = await supabase
      .from('invoiceManager_refundOrder')
      .select('refund_amount')
      .eq('master_account', masterAccount);

    if (refundError) {
      console.error('환불 데이터 조회 오류:', refundError);
      return NextResponse.json({
        success: false,
        error: '환불 데이터를 조회하는데 실패했습니다.',
        details: refundError
      }, { status: 500 });
    }

    // 3. 라이브 잔액 계산
    let liveBalance = 0;

    // 3-1. 트랜잭션: 충전은 +, 차감은 -
    if (transactionsData && transactionsData.length > 0) {
      transactionsData.forEach((transaction) => {
        const amount = transaction.amount || 0;
        if (transaction.transaction_type === '충전') {
          liveBalance += amount;
        } else if (transaction.transaction_type === '차감') {
          liveBalance -= amount;
        }
      });
    }

    // 3-2. 환불금액: 모두 +
    if (refundData && refundData.length > 0) {
      refundData.forEach((refund) => {
        const refundAmount = refund.refund_amount || 0;
        liveBalance += refundAmount;
      });
    }

    console.log('라이브 잔액 계산 결과:', {
      transactions: transactionsData?.length || 0,
      refunds: refundData?.length || 0,
      liveBalance
    });

    return NextResponse.json({
      success: true,
      liveBalance
    });
  } catch (error) {
    console.error('라이브 잔액 조회 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '라이브 잔액 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
