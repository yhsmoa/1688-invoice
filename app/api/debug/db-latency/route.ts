import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/debug/db-latency?n=5
//
// 서버(Railway) → Supabase PostgREST 왕복 1회가 실제로 몇 ms 인지 잰다 (읽기 전용 진단).
//   · 아주 가벼운 쿼리(ft_users 1행)를 n번 순서대로 보내 호출별 ms 를 돌려준다.
//   · 첫 호출만 느리고 나머지가 빠르면 연결 재사용(keep-alive)이 되는 것이고,
//     전부 비슷하게 느리면 리전 간 지연이 호출마다 그대로 드는 것이다.
//   2026-11-05: 조회 API 를 RPC 1회로 줄인 뒤에도 호출당 수백 ms 가 남아 원인을 가르기 위해 추가.
// ============================================================
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const n = Math.min(20, Math.max(1, Number(new URL(request.url).searchParams.get('n') ?? 5)));
  const calls: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const { error } = await supabase.from('ft_users').select('id').limit(1);
    if (error) {
      return NextResponse.json({ success: false, error: error.message, calls }, { status: 500 });
    }
    calls.push(Math.round(performance.now() - t));
  }
  return NextResponse.json({ success: true, calls, region: process.env.RAILWAY_REPLICA_REGION ?? null });
}
