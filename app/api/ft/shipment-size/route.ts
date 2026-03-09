import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// shipment_size_legacy → 사이즈 코드 매핑
// ============================================================
const SIZE_MAP: Record<string, string> = {
  Small: 'A',
  Medium: 'B',
  Large: 'C',
};

// ============================================================
// POST /api/ft/shipment-size
// 바코드 배열을 받아 ft_cp_item → ft_cp_shipment_size 조인으로
// 각 바코드의 사이즈 코드(A/B/C)를 반환
//
// Request:  { barcodes: string[] }
// Response: { success: true, data: { [barcode]: "A"|"B"|"C"|null } }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { barcodes } = body;

    if (!barcodes || !Array.isArray(barcodes) || barcodes.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    // ── 1) ft_cp_item: barcode → option_id 조회 (배치) ──
    const BATCH_SIZE = 100;
    const cpItems: { barcode: string; option_id: string }[] = [];

    for (let i = 0; i < barcodes.length; i += BATCH_SIZE) {
      const batch = barcodes.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('ft_cp_item')
        .select('barcode, option_id')
        .in('barcode', batch);

      if (error) throw error;
      if (data) cpItems.push(...data);
    }

    if (cpItems.length === 0) {
      return NextResponse.json({ success: true, data: {} });
    }

    // ── 2) ft_cp_shipment_size: option_id → shipment_size_legacy 조회 (배치) ──
    const optionIds = [...new Set(cpItems.map((c) => c.option_id).filter(Boolean))];
    const sizeRows: { option_id: string; shipment_size_legacy: string | null }[] = [];

    for (let i = 0; i < optionIds.length; i += BATCH_SIZE) {
      const batch = optionIds.slice(i, i + BATCH_SIZE);
      const { data, error } = await supabase
        .from('ft_cp_shipment_size')
        .select('option_id, shipment_size_legacy')
        .in('option_id', batch);

      if (error) throw error;
      if (data) sizeRows.push(...data);
    }

    // ── 3) option_id → shipment_size_legacy 맵 ──
    const optionSizeMap = new Map<string, string | null>();
    for (const row of sizeRows) {
      optionSizeMap.set(row.option_id, row.shipment_size_legacy);
    }

    // ── 4) barcode → size_code 최종 맵 구성 ──
    const result: Record<string, string | null> = {};
    for (const cpItem of cpItems) {
      const legacy = optionSizeMap.get(cpItem.option_id) || null;
      result[cpItem.barcode] = legacy ? (SIZE_MAP[legacy] || null) : null;
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('shipment-size 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'shipment-size 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
