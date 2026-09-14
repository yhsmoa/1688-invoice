import { NextResponse } from 'next/server';

// ============================================================
// GET /api/exchange-rate — 금일 환율 (원/위안)
//
// 고객계좌(신) "환산금액" 열의 참고 환율. 금액의 기준은 위안이며, 원화는 이용자가
// 대략 판단하기 위한 보조 표시일 뿐이다. (참조 프로젝트 purchase-agent 와 동일 출처·규칙)
//
//   응답: { rate: number, updatedAt: string }   // rate = 1위안당 원화
//   출처: ExchangeRate-API open access (키 불필요, 하루 1회 갱신)
//   캐시: 서버 프로세스 메모리에 CACHE_TTL_MS 동안 보관. 외부 호출 실패 시 이전 캐시가
//         있으면 그 값을 돌려주고, 캐시도 없으면 502 — 호출 측은 환산금액을 표시하지 않는다.
// ============================================================

export const dynamic = 'force-dynamic';

const RATE_ENDPOINT = 'https://open.er-api.com/v6/latest/CNY';
/** 출처가 하루 1회 갱신되므로 1시간 캐시면 충분 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// ── 프로세스 메모리 캐시 ──
let cache: { rate: number; updatedAt: string; fetchedAt: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ rate: cache.rate, updatedAt: cache.updatedAt });
  }

  try {
    const res = await fetch(RATE_ENDPOINT, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const rate = Number(data?.rates?.KRW);
    if (data?.result !== 'success' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('invalid rate payload');
    }

    const updatedAt = data.time_last_update_unix
      ? new Date(Number(data.time_last_update_unix) * 1000).toISOString()
      : new Date().toISOString();

    cache = { rate, updatedAt, fetchedAt: Date.now() };
    return NextResponse.json({ rate, updatedAt });
  } catch (err) {
    console.error('[exchange-rate] 환율 조회 실패:', err);
    if (cache) {
      return NextResponse.json({ rate: cache.rate, updatedAt: cache.updatedAt });
    }
    return NextResponse.json({ error: 'exchange rate unavailable' }, { status: 502 });
  }
}
