import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { deliveryRowScore } from '../../../../lib/deliveryRowPick';

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
//       courier: string,       // 택배사 (2026-09 이후 CSV)
//       tracking_no: string,   // 송장번호 (2026-09 이후 CSV)
//       status_since: string,   // 현재 배송상태가 된 시점 (경고 판정용)
//       location_since: string, // 현재 배송위치 문구가 된 시점 (경고 판정용)
//     }
//   }
// }
//
// 규칙:
//   · .in() 필터는 500개씩 청크
//   · 동일 order_no 가 여러 건이면 "가장 진행된 탭" 1건만 유지
//     → 판정 기준은 lib/deliveryRowPick (업로드 API 의 배송 이력 반영과 공용)
//   · 페이지네이션 루프 (1000행 limit 우회)
// ============================================================

const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

interface DeliveryStatusRow {
  '1688_order_no': string;
  order_status: string | null;
  delivery_status: string | null;
  description: string | null;
  timestamp: string | null;
  courier: string | null;
  tracking_no: string | null;
  status_since: string | null;
  location_since: string | null;
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
      courier: string;
      tracking_no: string;
      status_since: string;
      location_since: string;
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
          .select('"1688_order_no", order_status, delivery_status, description, timestamp, courier, tracking_no, status_since, location_since')
          .in('1688_order_no', chunk)
          .order('timestamp', { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data as unknown as DeliveryStatusRow[]) {
          const key = row['1688_order_no'];
          if (!key) continue;
          // 탭 우선순위 기준으로 더 나은 행이면 교체 (timestamp 동점 문제 해소)
          const score = deliveryRowScore(row);
          if (result[key] && bestScore[key] >= score) continue;
          bestScore[key] = score;
          result[key] = {
            order_status: row.order_status ?? '',
            delivery_status: row.delivery_status ?? '',
            description: row.description ?? '',
            timestamp: row.timestamp ?? '',
            courier: row.courier ?? '',
            tracking_no: row.tracking_no ?? '',
            status_since: row.status_since ?? '',
            location_since: row.location_since ?? '',
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
