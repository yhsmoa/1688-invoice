import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/label-print-logs/summary  { order_item_ids: string[] }
//   → { success, data: { [order_item_id]: { barcode: number; care: number } } }
//
// 상품입고 V3 의 세트 라벨 스티커 "1세트 1장" 계산용.
//   printLabels() 는 세트의 대표 행(order_item_id 1개)에만 기록을 남기므로,
//   호출 측은 세트 구성품(형제 행) 전체 id 를 넘겨 합산해야 한다.
//
// label_print_logs 는 1만 건을 넘는다 (2026-10-18 기준 11,511) →
//   id 100개 단위 .in() 배치 + 1000행 range 페이지네이션 (lib/confirmDone.ts fetchAll 패턴).
// 기록은 2026-09-08 부터만 있다 — 그 전 BarTender 출력분은 0 으로 나온다.
//
// lastBarcode: 그 행의 가장 최근 라벨 스티커 출력 (언제·누가·어느 PC)
//   → 세트 스티커를 건너뛰기 전에 "이미 ○○이 출력했습니다" 확인 문구에 쓴다.
// ============================================================

const TABLE = 'label_print_logs';
const ID_BATCH = 100;
const PAGE = 1000;

interface LogRow {
  order_item_id: string | null;
  label_type: string | null;
  qty: number | null;
  printed_at: string | null;
  printed_by: string | null;
  station_no: number | null;
}

interface LastPrint {
  at: string;
  by: string | null;
  station: number | null;
}

interface SummaryEntry {
  barcode: number;
  care: number;
  lastBarcode: LastPrint | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids: string[] = Array.isArray(body?.order_item_ids)
      ? Array.from(new Set((body.order_item_ids as unknown[]).filter((v): v is string => typeof v === 'string' && !!v)))
      : [];

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    const summary: Record<string, SummaryEntry> = {};

    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const batch = ids.slice(i, i + ID_BATCH);
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from(TABLE)
          .select('order_item_id, label_type, qty, printed_at, printed_by, station_no')
          .in('order_item_id', batch)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data as LogRow[]) {
          if (!row.order_item_id) continue;
          const entry = (summary[row.order_item_id] ??= { barcode: 0, care: 0, lastBarcode: null });
          if (row.label_type === 'barcode') {
            entry.barcode += row.qty ?? 0;
            if (row.printed_at && (!entry.lastBarcode || row.printed_at > entry.lastBarcode.at)) {
              entry.lastBarcode = { at: row.printed_at, by: row.printed_by, station: row.station_no };
            }
          } else if (row.label_type === 'care') {
            entry.care += row.qty ?? 0;
          }
        }

        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error('라벨 인쇄기록 합계 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '라벨 인쇄 기록 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
