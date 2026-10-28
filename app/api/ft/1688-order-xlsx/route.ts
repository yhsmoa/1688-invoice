import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { buyerAccountBadge } from '../../../../lib/buyerAccountBadge';

// ============================================================
// POST /api/ft/1688-order-xlsx
//
// 1688 주문번호 → [1688 XLSX](1688_invoice_deliveryInfo_check) 에 담긴 주문 정보
//   · accounts : 그 주문이 들어 있는 1688 계정 (buyer_account) + 배지 글자 (N / Y)
//   · statuses : 1688 주문상태 (엑셀 J열 订单状态 — 交易关闭 · 退款中 등)
// 주문상태 V2 의 계정 배지 · [주문누락?] 판정용
//
// Request:  { order_ids: string[] }
// Response: {
//   success: true,
//   data: {
//     [1688_order_id]: {
//       accounts: [{ account: string, badge: string }],
//       statuses: string[],
//     }
//   }
// }
//
// 규칙:
//   · .in() 필터는 500개씩 청크
//   · 페이지네이션 루프 (1000행 limit 우회) — 주문 1건이 엑셀 여러 행일 수 있다
//   · 주문 1건이 두 계정 엑셀에 모두 있으면 둘 다 반환 (계정 ID 순)
//   · 주문상태는 주문 단위 값이라 보통 1개 (엑셀 행끼리 다르면 모두, 가나다순)
//   · 배지 글자는 env BUYER_ACCOUNT_BADGES (lib/buyerAccountBadge)
//   · 엑셀에 없는 주문은 응답에 없음
// ============================================================

const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

interface XlsxRow {
  order_id: string | null;
  buyer_account: string;
  delivery_status: string | null;
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

    // ── 청크별 조회 → 주문별 계정 · 상태 모으기 ──
    const byOrder = new Map<string, { accounts: Set<string>; statuses: Set<string> }>();

    for (let i = 0; i < uniqueIds.length; i += IN_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + IN_CHUNK_SIZE);

      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('1688_invoice_deliveryInfo_check')
          .select('order_id, buyer_account, delivery_status')
          .in('order_id', chunk)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data as XlsxRow[]) {
          if (!row.order_id) continue;
          const entry = byOrder.get(row.order_id) ?? { accounts: new Set<string>(), statuses: new Set<string>() };
          entry.accounts.add(row.buyer_account);
          const status = row.delivery_status?.trim();
          if (status) entry.statuses.add(status);
          byOrder.set(row.order_id, entry);
        }

        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // ── 응답 ──
    const result: Record<string, { accounts: Array<{ account: string; badge: string }>; statuses: string[] }> = {};
    byOrder.forEach((entry, orderId) => {
      result[orderId] = {
        accounts: Array.from(entry.accounts)
          .sort()
          .map((account) => ({ account, badge: buyerAccountBadge(account) })),
        statuses: Array.from(entry.statuses).sort(),
      };
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('1688-order-xlsx 조회 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: '1688 주문 엑셀 정보 조회 중 오류', details: message },
      { status: 500 }
    );
  }
}
