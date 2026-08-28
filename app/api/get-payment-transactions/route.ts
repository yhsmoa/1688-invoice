import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// invoiceManager_transactions.user_id 는 ft_users.id(UUID) 로 이관됐다.
// 화면이 아직 username 을 보낼 수 있으므로 양쪽 모두 받아 UUID 로 해석한다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveUserId(raw: string): Promise<string | null> {
  if (UUID_RE.test(raw)) return raw;
  const { data } = await supabase
    .from('ft_users')
    .select('id')
    .eq('username', raw)
    .maybeSingle();
  return data?.id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUserId = searchParams.get('user_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const transactionType = searchParams.get('transaction_type');

    if (!rawUserId) {
      return NextResponse.json({ success: false, error: 'user_id가 필요합니다.' }, { status: 400 });
    }

    const userId = await resolveUserId(rawUserId);
    if (!userId) {
      // 매칭되는 사용자가 없으면 빈 목록 (오류가 아니라 데이터 없음)
      return NextResponse.json({ success: true, data: [] });
    }

    // 1000행 limit 대응 — 페이지네이션 루프로 전체 조회 (누적잔액 정확도 보장)
    const PAGE = 1000;
    const all: unknown[] = [];
    let from = 0;
    while (true) {
      let query = supabase
        .from('invoiceManager_transactions')
        .select('id, order_code, user_id, transaction_type, description, admin_note, item_qty, amount, price, delivery_fee, service_fee, extra_fee, balance_after, status, date, created_at, updated_at')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      // 기간 필터 (date 기준)
      if (startDate) query = query.gte('date', startDate);
      if (endDate) query = query.lte('date', endDate);
      // 타입 필터
      if (transactionType && transactionType !== 'all') query = query.eq('transaction_type', transactionType);

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({
          success: false,
          error: '트랜잭션 조회 실패',
          details: error.message
        }, { status: 500 });
      }

      const chunk = data ?? [];
      all.push(...chunk);
      if (chunk.length < PAGE) break;
      from += PAGE;
    }

    return NextResponse.json({ success: true, data: all });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '트랜잭션 조회 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
