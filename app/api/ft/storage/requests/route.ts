import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { serverError } from '../storageShared';
import type { StorageRequest } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/requests[?user_id=] — user_id 가 없으면 전체 사업자
//   고객의 재고 쉽먼트 요청 — 미처리(REQUESTED) 전부 + 최근 24시간 안에 처리완료(DONE)
//   (purchase-agent 가 ft_storage_request_create 로 만든다. 처리완료는 pick 함수가 한다)
// ============================================================

const PAGE = 1000;
const DONE_VISIBLE_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');

  try {
    const doneSince = new Date(Date.now() - DONE_VISIBLE_MS).toISOString();
    const all: StorageRequest[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from('ft_storage_requests').select('*');
      if (userId) q = q.eq('user_id', userId);
      const { data, error } = await q
        .or(`status.eq.REQUESTED,and(status.eq.DONE,done_at.gte.${doneSince})`)
        .order('requested_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...((data ?? []) as StorageRequest[]));
      if (!data || data.length < PAGE) break;
    }
    return NextResponse.json({ success: true, data: all });
  } catch (error) {
    return serverError('재고 요청 조회', error);
  }
}
