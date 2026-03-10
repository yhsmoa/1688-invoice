import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/ft/shipment-details?shipment_id=X&user_id=X
//   확정된 쉽먼트 데이터 조회 (ft_shipment_details)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shipmentId = searchParams.get('shipment_id');
    const userId = searchParams.get('user_id');

    if (!shipmentId || !userId) {
      return NextResponse.json(
        { success: false, error: 'shipment_id, user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // 페이징으로 전체 조회
    const PAGE = 1000;
    const all: Record<string, unknown>[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('ft_shipment_details')
        .select('*')
        .eq('shipment_id', shipmentId)
        .eq('user_id', userId)
        .order('box_code', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    return NextResponse.json({ success: true, data: all, confirmed: all.length > 0 });
  } catch (error) {
    console.error('shipment-details GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확정 데이터 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/ft/shipment-details
//   [확정] 시 스냅샷 저장
//   Body: { shipment_id, user_id, rows: ShipmentDetailRow[] }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { shipment_id, user_id, rows } = body;

    if (!shipment_id || !user_id || !rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'shipment_id, user_id, rows가 필요합니다.' },
        { status: 400 }
      );
    }

    // 중복 확인
    const { data: existing, error: checkErr } = await supabase
      .from('ft_shipment_details')
      .select('id')
      .eq('shipment_id', shipment_id)
      .eq('user_id', user_id)
      .limit(1);

    if (checkErr) throw checkErr;

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { success: false, error: '이미 확정된 쉽먼트입니다. 확정 취소 후 다시 시도해주세요.' },
        { status: 409 }
      );
    }

    // rows를 ft_shipment_details 형식으로 매핑
    const now = new Date().toISOString();
    const insertRows = rows.map((r: Record<string, unknown>) => ({
      shipment_id,
      user_id,
      order_item_id: r.order_item_id || null,
      fulfillment_ids: r.ids || [r.id],
      box_code: r.box_code || null,
      master_box_code: r.master_box_code || null,
      shipment_no: r.shipment_no || null,
      product_no: r.product_no || null,
      barcode: r.barcode || null,
      item_name: r.item_name || null,
      option_name: r.option_name || null,
      china_option1: r.china_option1 || null,
      china_option2: r.china_option2 || null,
      price_cny: r.price_cny ?? null,
      customs_category: r.customs_category || null,
      shipment_size: r.shipment_size || null,
      quantity: r.quantity ?? 0,
      available_qty: r.available_qty ?? 0,
      total_qty: r.total_qty ?? 0,
      img_url: r.img_url || null,
      composition: r.composition || null,
      confirmed_at: now,
    }));

    // 100개씩 배치 insert
    const BATCH = 100;
    let insertCount = 0;
    for (let i = 0; i < insertRows.length; i += BATCH) {
      const batch = insertRows.slice(i, i + BATCH);
      const { error } = await supabase.from('ft_shipment_details').insert(batch);
      if (error) throw error;
      insertCount += batch.length;
    }

    console.log(`shipment-details 확정 저장: ${insertCount}건 (shipment_id=${shipment_id})`);

    return NextResponse.json({ success: true, count: insertCount });
  } catch (error) {
    console.error('shipment-details POST 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확정 데이터 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/ft/shipment-details
//   확정 취소 (shipment_id + user_id 기준 일괄 삭제)
//   Body: { shipment_id, user_id }
// ============================================================
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { shipment_id, user_id } = body;

    if (!shipment_id || !user_id) {
      return NextResponse.json(
        { success: false, error: 'shipment_id, user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('ft_shipment_details')
      .delete()
      .eq('shipment_id', shipment_id)
      .eq('user_id', user_id);

    if (error) throw error;

    console.log(`shipment-details 확정 취소: shipment_id=${shipment_id}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('shipment-details DELETE 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확정 취소 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
