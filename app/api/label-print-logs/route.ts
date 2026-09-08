import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// 라벨 인쇄 기록 — label_print_logs
//
//   POST /api/label-print-logs   { items: [...] }  인쇄 성공 후 일괄 기록
//   GET  /api/label-print-logs?limit=  최근 기록 (기본 100)
//
// 기존 invoiceManager_label 이 하던 "무엇을 몇 장 뽑았나" 기록 역할을 이어받는다.
// 인쇄 자체가 실패해도 입고 저장은 막지 않으므로, 기록 실패도 치명적이지 않게 처리.
// ============================================================

const TABLE = 'label_print_logs';

export async function POST(request: NextRequest) {
  try {
    const { items } = await request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '기록할 항목이 없습니다.' },
        { status: 400 }
      );
    }

    const rows = items.map((it: Record<string, unknown>) => ({
      template_id: it.template_id ?? null,
      order_item_id: it.order_item_id ?? null,
      barcode: it.barcode ?? null,
      item_name: it.item_name ?? null,
      qty: Number(it.qty ?? 1),
      station_no: it.station_no ?? null,
      label_type: it.label_type ?? null,
      printed_by: it.printed_by ?? null,
    }));

    const { data, error } = await supabase.from(TABLE).insert(rows).select('id');
    if (error) throw error;

    return NextResponse.json({ success: true, count: data?.length ?? 0 });
  } catch (error) {
    console.error('라벨 인쇄기록 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '인쇄 기록 저장 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 100), 1000);

    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('printed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('라벨 인쇄기록 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '인쇄 기록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
