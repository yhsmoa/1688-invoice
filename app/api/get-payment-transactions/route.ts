import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const transactionType = searchParams.get('transaction_type');

    if (!userId) {
      return NextResponse.json({ success: false, error: 'user_id가 필요합니다.' }, { status: 400 });
    }

    let query = supabase
      .from('invoiceManager_transactions')
      .select('id, order_code, user_id, transaction_type, description, admin_note, item_qty, amount, price, delivery_fee, service_fee, extra_fee, balance_after, status, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // 기간 필터
    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59`);
    }

    // 타입 필터
    if (transactionType && transactionType !== 'all') {
      query = query.eq('transaction_type', transactionType);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({
        success: false,
        error: '트랜잭션 조회 실패',
        details: error.message
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '트랜잭션 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
