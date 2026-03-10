import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { normalizeSizeCode } from '../../../../lib/sizeCode';

// ============================================================
// Supabase 기본 limit(1000) 우회 — 전체 데이터 조회 헬퍼
// ============================================================
async function fetchAll<T>(
  table: string,
  select: string,
  filters: { column: string; op: 'eq' | 'in' | 'is'; value: unknown }[]
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(select).range(from, from + PAGE - 1);
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.column, f.value);
      else if (f.op === 'in') query = query.in(f.column, f.value as string[]);
      else if (f.op === 'is') query = query.is(f.column, f.value as null);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ============================================================
// 배치 조회 헬퍼 (in 조건, 100개 단위)
// ============================================================
async function batchIn<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
  extraFilters?: { column: string; op: 'eq'; value: unknown }[]
): Promise<T[]> {
  const BATCH = 100;
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    let query = supabase.from(table).select(select).in(column, batch);
    if (extraFilters) {
      for (const f of extraFilters) query = query.eq(f.column, f.value);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (data) all.push(...(data as T[]));
  }
  return all;
}

// ============================================================
// GET /api/ft/shipment-v2?user_id=X
//   기본: ft_fulfillments (PACKED, shipment_id IS NULL) → 미출고 목록
//   ?shipment_id=UUID → 특정 쉽먼트의 출고완료 목록
// + ft_order_items JOIN
// + ft_box_info → master_box_code, master_box_id
// + ft_cp_item → ft_cp_shipment_size (쉽먼트사이즈)
// + 전체 수량 (order_item_id 기준 총 PACKED qty)
// + 입고 수량 (ARRIVAL - CANCEL - shipment=true)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── shipment_id 파라미터: 있으면 특정 쉽먼트 조회, 없으면 미출고(shipment_id IS NULL) ──
    const shipmentId = searchParams.get('shipment_id');

    // ── 1) ft_fulfillments: PACKED & shipment_id 조건 조회 (limit 해제) ──
    const ffFilters: { column: string; op: 'eq' | 'in' | 'is'; value: unknown }[] = [
      { column: 'user_id', op: 'eq', value: userId },
      { column: 'type', op: 'eq', value: 'PACKED' },
    ];
    if (shipmentId) {
      // 특정 쉽먼트의 출고완료 목록
      ffFilters.push({ column: 'shipment_id', op: 'eq', value: shipmentId });
    } else {
      // 미출고 목록 (shipment_id IS NULL)
      ffFilters.push({ column: 'shipment_id', op: 'is', value: null });
    }

    const fulfillments = await fetchAll<{
      id: string;
      box_code: string | null;
      order_item_id: string;
      quantity: number;
      product_no: string | null;
      shipment_no: string | null;
    }>('ft_fulfillments', 'id, box_code, order_item_id, quantity, product_no, shipment_no', ffFilters);

    if (fulfillments.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const orderItemIds = [...new Set(fulfillments.map((f) => f.order_item_id).filter(Boolean))];

    // ── 2) ft_order_items: 상품 정보 조회 ──
    const oiRows = await batchIn<{
      id: string; barcode: string; item_name: string; option_name: string;
      china_option1: string | null; china_option2: string | null; product_no: string | null;
      price_cny: number | null; price_delivery_cny: number | null;
      img_url: string | null; composition: string | null;
      customs_category: string | null;
      set_total: number | null; product_id: string | null;
    }>(
      'ft_order_items',
      'id, barcode, item_name, option_name, china_option1, china_option2, product_no, price_cny, price_delivery_cny, img_url, composition, customs_category, set_total, product_id',
      'id',
      orderItemIds
    );

    const orderItems: Record<string, typeof oiRows[0]> = {};
    for (const row of oiRows) orderItems[row.id] = row;

    // ── 2b) 세트상품 단가 합산: product_id별 SUM(price_cny + price_delivery_cny) ──
    const setProductIds = [...new Set(
      oiRows.filter((r) => (r.set_total ?? 0) > 1 && r.product_id).map((r) => r.product_id!)
    )];

    const setPriceMap = new Map<string, number>(); // product_id → 합산 단가

    if (setProductIds.length > 0) {
      const setRows = await batchIn<{
        product_id: string; price_cny: number | null; price_delivery_cny: number | null;
      }>('ft_order_items', 'product_id, price_cny, price_delivery_cny', 'product_id', setProductIds);

      for (const s of setRows) {
        const sum = (s.price_cny ?? 0) + (s.price_delivery_cny ?? 0);
        setPriceMap.set(s.product_id, (setPriceMap.get(s.product_id) ?? 0) + sum);
      }
    }

    // ── 3) ft_fulfillments: 입고 수량 + 전체 PACKED 수량 계산용 이력 조회 ──
    const allFf = await batchIn<{
      order_item_id: string; quantity: number; type: string; shipment_id: string | null;
    }>('ft_fulfillments', 'order_item_id, quantity, type, shipment_id', 'order_item_id', orderItemIds);

    // 입고 = ARRIVAL - CANCEL - (PACKED where shipment_id IS NOT NULL)
    const availableMap = new Map<string, number>();
    // 전체 PACKED 수량 (box_code 무관, order_item_id 기준)
    const totalPackedMap = new Map<string, number>();

    for (const f of allFf) {
      if (f.type === 'ARRIVAL') {
        availableMap.set(f.order_item_id, (availableMap.get(f.order_item_id) ?? 0) + f.quantity);
      } else if (f.type === 'CANCEL') {
        availableMap.set(f.order_item_id, (availableMap.get(f.order_item_id) ?? 0) - f.quantity);
      }
      // 이미 쉽먼트에 배정된 PACKED → 입고에서 차감
      if (f.type === 'PACKED' && f.shipment_id != null) {
        availableMap.set(f.order_item_id, (availableMap.get(f.order_item_id) ?? 0) - f.quantity);
      }
      if (f.type === 'PACKED') {
        totalPackedMap.set(f.order_item_id, (totalPackedMap.get(f.order_item_id) ?? 0) + f.quantity);
      }
    }

    // ── 4) ft_box_info: master_box_code, master_box_id 조회 ──
    const uniqueBoxCodes = [...new Set(fulfillments.map((f) => f.box_code).filter(Boolean))] as string[];
    const boxInfoRows = uniqueBoxCodes.length > 0
      ? await batchIn<{
          box_code: string;
          master_box_id: string | null;
          master_box_code: string | null;
        }>('ft_box_info', 'box_code, master_box_id, master_box_code', 'box_code', uniqueBoxCodes)
      : [];

    const boxInfoMap = new Map<string, { master_box_id: string | null; master_box_code: string | null }>();
    for (const b of boxInfoRows) {
      boxInfoMap.set(b.box_code, { master_box_id: b.master_box_id, master_box_code: b.master_box_code });
    }

    // ── 5) 쉽먼트사이즈: barcode → ft_cp_item → ft_cp_shipment_size ──
    const barcodes = [...new Set(oiRows.map((r) => r.barcode).filter(Boolean))];
    const sizeMap: Record<string, string | null> = {};

    if (barcodes.length > 0) {
      const cpItems = await batchIn<{ barcode: string; option_id: string }>(
        'ft_cp_item', 'barcode, option_id', 'barcode', barcodes
      );

      if (cpItems.length > 0) {
        const optionIds = [...new Set(cpItems.map((c) => c.option_id).filter(Boolean))];
        const sizeRows = await batchIn<{ option_id: string; shipment_size_legacy: string | null }>(
          'ft_cp_shipment_size', 'option_id, shipment_size_legacy', 'option_id', optionIds
        );

        const optSizeMap = new Map<string, string | null>();
        for (const s of sizeRows) optSizeMap.set(s.option_id, s.shipment_size_legacy);

        for (const cp of cpItems) {
          const legacy = optSizeMap.get(cp.option_id) || null;
          sizeMap[cp.barcode] = normalizeSizeCode(legacy);
        }
      }
    }

    // ── 6) 개별 fulfillment 행 + 조인 결과 구성 (병합 없음, 1:1) ──
    const result = fulfillments.map((ff) => {
      const oi = orderItems[ff.order_item_id];
      const barcode = oi?.barcode || null;
      const boxInfo = ff.box_code ? boxInfoMap.get(ff.box_code) : null;

      // 단가 계산: 세트상품이면 product_id별 합산, 일반상품이면 price_cny + price_delivery_cny
      let totalPrice: number | null = null;
      if (oi) {
        if ((oi.set_total ?? 0) > 1 && oi.product_id) {
          totalPrice = setPriceMap.get(oi.product_id) ?? null;
        } else {
          totalPrice = (oi.price_cny ?? 0) + (oi.price_delivery_cny ?? 0);
        }
      }

      return {
        id: ff.id,
        box_code: ff.box_code,
        master_box_id: boxInfo?.master_box_id || null,
        master_box_code: boxInfo?.master_box_code || null,
        order_item_id: ff.order_item_id,
        quantity: ff.quantity,
        total_qty: totalPackedMap.get(ff.order_item_id) ?? 0,
        available_qty: availableMap.get(ff.order_item_id) ?? 0,
        shipment_size: barcode ? (sizeMap[barcode] ?? null) : null,
        product_no: ff.product_no || oi?.product_no || null,
        barcode,
        item_name: oi?.item_name || null,
        option_name: oi?.option_name || null,
        china_option1: oi?.china_option1 || null,
        china_option2: oi?.china_option2 || null,
        price_cny: totalPrice,
        img_url: oi?.img_url || null,
        composition: oi?.composition || null,
        customs_category: oi?.customs_category || null,
        shipment_no: ff.shipment_no || null,
      };
    });

    // box_code 기준 정렬
    result.sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('shipment-v2 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '쉽먼트 V2 데이터 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/ft/shipment-v2
// ft_fulfillments 행 업데이트 (box_code 이동, available_qty 수정 등)
// Body: { updates: { id: string, fields: Record<string, unknown> }[] }
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates } = body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { success: false, error: '업데이트할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    let count = 0;
    await Promise.all(
      updates.map(async (u: { id: string; fields: Record<string, unknown> }) => {
        const { error } = await supabase
          .from('ft_fulfillments')
          .update(u.fields)
          .eq('id', u.id);
        if (error) throw error;
        count++;
      })
    );

    return NextResponse.json({ success: true, count });
  } catch (error) {
    console.error('shipment-v2 PATCH 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '쉽먼트 V2 업데이트 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
