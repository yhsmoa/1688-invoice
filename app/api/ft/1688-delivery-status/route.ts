import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/ft/1688-delivery-status
//
// im_1688_orders_delivery_status 테이블에서 배송 상태 조회
//
// Request:  { order_ids: string[] }
// Response: {
//   success: true,
//   data: {
//     [1688_order_no]: {
//       order_status: string,
//       delivery_status: string,
//       description: string,
//       timestamp: string,
//     }
//   }
// }
//
// 규칙:
//   · .in() 필터는 500개씩 청크
//   · 동일 order_no 가 여러 건이면 "가장 진행된 탭" 1건만 유지 (아래 참조)
//   · 페이지네이션 루프 (1000행 limit 우회)
//
// ── 왜 timestamp 로 고르지 않는가 ─────────────────────────
// CSV 는 1688 주문목록을 탭별로 덤프한 것이라 한 주문이 여러 탭에 중복 등장한다.
//   待发货 탭 행  : delivery_status 가 待发货/待收货 뿐, 상세 없음 (플레이스홀더)
//   待收货 탭 행  : 已签收/运输中/派送中/已发货 등 실제 물류 상태 + 상세
//   退款售后 탭 행: 환불 진행 상태
// 그런데 같은 주문의 행들은 timestamp 가 모두 동일(주문일시)해서 정렬로 구분이
// 불가능하다 → 동점이면 순서가 비결정적이라 플레이스홀더 행이 뽑힐 수 있었다.
// (실측: 중복 주문 553건 전부 timestamp 동일, 그중 282건이 오표시 가능)
//
// → order_status(탭) 우선순위로 실제 물류 상태 행을 고른다.
//   동일 탭이면 상세 있는 행 → timestamp 최신 순.
// ============================================================

const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

// 탭 우선순위 — 클수록 실제 배송 상태에 가까움
const TAB_PRIORITY: Record<string, number> = {
  '待收货':   3,  // 수령 대기 — 실제 물류 상태(운송중/배송완료 등)
  '退款售后': 2,  // 환불/사후 — 배송은 끝났고 환불 진행
  '待发货':   1,  // 발송 대기 — 플레이스홀더
};

/** 같은 주문의 두 행 중 어느 쪽을 표시할지 — 크면 우선 */
function rowScore(row: DeliveryStatusRow): number {
  const tab = TAB_PRIORITY[row.order_status ?? ''] ?? 0;
  const hasDesc = row.description && row.description.trim() !== '' ? 1 : 0;
  const ts = row.timestamp ? Date.parse(row.timestamp) : 0;
  // 탭 > 상세유무 > 최신 순 (자릿수 분리로 안정적 비교)
  return tab * 1e15 + hasDesc * 1e14 + (isNaN(ts) ? 0 : ts);
}

interface DeliveryStatusRow {
  '1688_order_no': string;
  order_status: string | null;
  delivery_status: string | null;
  description: string | null;
  timestamp: string | null;
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

    // ── 청크별 조회 + 주문당 최적 1건 유지 ──
    const result: Record<string, {
      order_status: string;
      delivery_status: string;
      description: string;
      timestamp: string;
    }> = {};
    // 현재 채택된 행의 점수 (더 높은 점수가 오면 교체)
    const bestScore: Record<string, number> = {};

    for (let i = 0; i < uniqueIds.length; i += IN_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + IN_CHUNK_SIZE);

      // 페이지네이션 루프
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('im_1688_orders_delivery_status')
          .select('"1688_order_no", order_status, delivery_status, description, timestamp')
          .in('1688_order_no', chunk)
          .order('timestamp', { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data as unknown as DeliveryStatusRow[]) {
          const key = row['1688_order_no'];
          if (!key) continue;
          // 탭 우선순위 기준으로 더 나은 행이면 교체 (timestamp 동점 문제 해소)
          const score = rowScore(row);
          if (result[key] && bestScore[key] >= score) continue;
          bestScore[key] = score;
          result[key] = {
            order_status: row.order_status ?? '',
            delivery_status: row.delivery_status ?? '',
            description: row.description ?? '',
            timestamp: row.timestamp ?? '',
          };
        }

        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error('1688-delivery-status 조회 오류:', error);
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: '배송 상태 조회 중 오류', details: message },
      { status: 500 }
    );
  }
}
