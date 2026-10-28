import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { buyerAccountBadge } from '../../../../lib/buyerAccountBadge';

// ============================================================
// POST /api/ft/1688-order-accounts
//
// 1688 주문번호 → 그 주문이 들어 있는 1688 계정 (1688_invoice_deliveryInfo_check.buyer_account)
// 주문상태 V2 상품정보 칸 끝의 계정 배지(N / Y) 표시용
//
// Request:  { order_ids: string[] }
// Response: {
//   success: true,
//   data: { [1688_order_id]: [{ account: string, badge: string }] }
// }
//
// 규칙:
//   · .in() 필터는 500개씩 청크
//   · 페이지네이션 루프 (1000행 limit 우회) — 주문 1건이 엑셀 여러 행일 수 있다
//   · 주문 1건이 두 계정 엑셀에 모두 있으면 둘 다 반환 (계정 ID 순)
//   · 배지 글자는 env BUYER_ACCOUNT_BADGES (lib/buyerAccountBadge)
// ============================================================

const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

interface AccountRow {
  order_id: string | null;
  buyer_account: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_ids } = body as { order_ids: unknown };

    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    // ── 중복 제거 + 빈 값 제외 ──
    const uniqueIds = Array.from(new Set(
      order_ids
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    ));
    if (uniqueIds.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    // ── 청크별 조회 → 주문별 계정 모으기 ──
    const accountsByOrder = new Map<string, Set<string>>();

    for (let i = 0; i < uniqueIds.length; i += IN_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + IN_CHUNK_SIZE);

      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('1688_invoice_deliveryInfo_check')
          .select('order_id, buyer_account')
          .in('order_id', chunk)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data as AccountRow[]) {
          if (!row.order_id) continue;
          const set = accountsByOrder.get(row.order_id) ?? new Set<string>();
          set.add(row.buyer_account);
          accountsByOrder.set(row.order_id, set);
        }

        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // ── 응답 ──
    const result: Record<string, Array<{ account: string; badge: string }>> = {};
    accountsByOrder.forEach((accounts, orderId) => {
      result[orderId] = Array.from(accounts)
        .sort()
        .map((account) => ({ account, badge: buyerAccountBadge(account) }));
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('1688-order-accounts 조회 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: '1688 주문 계정 조회 중 오류', details: message },
      { status: 500 }
    );
  }
}
