import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { normalizeSizeCode, resolveScanSizeCode } from '../../../../lib/sizeCode';
import { loadCustomsCategoryEnMap, toCustomsCategoryEn } from '../../../../lib/customsCategoryEn';

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
    let query = supabase.from(table).select(select).order('id', { ascending: true }).range(from, from + PAGE - 1);
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
//
//   키 100개라도 키당 행이 많으면 1000행을 넘을 수 있다 (입고·포장 이력).
//   · 1000행 미만 → 요청 1번
//   · 딱 1000행   → 잘렸을 수 있으므로 그 배치만 id 정렬 + range 루프로 끝까지 재조회
//   (조회 대상 테이블은 모두 id 컬럼 보유 — 2026-10-29 확인)
// ============================================================
async function batchIn<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
  extraFilters?: { column: string; op: 'eq'; value: unknown }[]
): Promise<T[]> {
  const BATCH = 100;
  const PAGE = 1000;
  const all: T[] = [];

  const baseQuery = (batch: string[]) => {
    let query = supabase.from(table).select(select).in(column, batch);
    if (extraFilters) {
      for (const f of extraFilters) query = query.eq(f.column, f.value);
    }
    return query;
  };

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);

    // ── 1차: 단일 요청 ──
    const { data, error } = await baseQuery(batch);
    if (error) throw error;
    const first = (data ?? []) as T[];
    if (first.length < PAGE) {
      all.push(...first);
      continue;
    }

    // ── 2차: 1000행에서 잘림 → id 정렬 range 루프 ──
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: pageErr } = await baseQuery(batch)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (pageErr) throw pageErr;
      const rows = (page ?? []) as T[];
      all.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return all;
}

const uniq = (values: (string | null | undefined)[]): string[] =>
  [...new Set(values.filter((v): v is string => !!v))];

// ============================================================
// 조회 행 타입
// ============================================================
interface OutboundRow {
  id: string;
  box_code: string | null;
  box_info_id: string | null;
  order_item_id: string | null;
  manual_item_id: string | null;
  quantity: number;
  product_no: string | null;
  shipment_no: string | null;
}

interface OrderItemRow {
  id: string; barcode: string; item_name: string; option_name: string;
  china_option1: string | null; china_option2: string | null; product_no: string | null;
  price_cny: number | null; price_delivery_cny: number | null; order_qty: number | null;
  img_url: string | null; composition: string | null;
  customs_category: string | null;
  set_total: number | null; product_id: string | null;
  vendor_option_id: string | null;
  shipment_type: string | null; coupang_shipment_size: string | null;
}

interface ManualItemRow {
  id: string;
  product_no: string;
  barcode: string | null;
  item_name: string;
  china_option: string | null;
  price_cny: number | null;
  customs_category: string | null;
  size_code: string;
  arrival_qty: number;
}

interface BoxInfoRow {
  id: string;
  box_code: string;
  type: string | null;
  size: string | null;
  master_box_id: string | null;
  master_box_code: string | null;
}

interface MoveRequestRow {
  id: string;
  outbound_id: string;
  target_type: string;
  from_box_code: string | null;
  requested_by: string | null;
  requested_at: string;
}

// ============================================================
// GET /api/ft/shipment-v2?user_id=X
//   기본: ft_fulfillment_outbounds (PACKED, shipment_id IS NULL) → 미출고 목록
//   ?shipment_id=UUID → 특정 쉽먼트의 출고완료 목록 (shipment-complete-v2)
//
//   행 1개 = 포장 행 1건. 상품 정보는 둘 중 하나에서 온다.
//     · order_item_id  → ft_order_items (일반 주문 상품)
//     · manual_item_id → ft_shipment_manual_items ([생성] 으로 추가한 부자재)
//   + ft_box_info (box_info_id 기준) → 박스 사이즈·타입·합배송 마스터
//   + invoiceManager-Customs → 품목 영문명
//   + ft_move_requests (미출고 목록일 때) → 고객 미처리 이동요청
//   + 전체 수량 / 입고 수량 계산
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

    // ── 1) ft_fulfillment_outbounds: PACKED & shipment_id 조건 조회 ──
    const ffFilters: { column: string; op: 'eq' | 'in' | 'is'; value: unknown }[] = [
      { column: 'user_id', op: 'eq', value: userId },
      { column: 'type', op: 'eq', value: 'PACKED' },
    ];
    if (shipmentId) {
      ffFilters.push({ column: 'shipment_id', op: 'eq', value: shipmentId });
    } else {
      ffFilters.push({ column: 'shipment_id', op: 'is', value: null });
    }

    const fulfillments = await fetchAll<OutboundRow>(
      'ft_fulfillment_outbounds',
      'id, box_code, box_info_id, order_item_id, manual_item_id, quantity, product_no, shipment_no',
      ffFilters
    );

    if (fulfillments.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const orderItemIds = uniq(fulfillments.map((f) => f.order_item_id));
    const manualItemIds = uniq(fulfillments.map((f) => f.manual_item_id));

    // ── 2) ft_order_items: 상품 정보 조회 ──
    const oiRows = orderItemIds.length > 0
      ? await batchIn<OrderItemRow>(
          'ft_order_items',
          'id, barcode, item_name, option_name, china_option1, china_option2, product_no, price_cny, price_delivery_cny, order_qty, img_url, composition, customs_category, set_total, product_id, vendor_option_id, shipment_type, coupang_shipment_size',
          'id',
          orderItemIds
        )
      : [];

    const orderItems: Record<string, OrderItemRow> = {};
    for (const row of oiRows) orderItems[row.id] = row;

    // ── 2-a) 부자재(수동 행) 정보 ──
    const manualRows = manualItemIds.length > 0
      ? await batchIn<ManualItemRow>(
          'ft_shipment_manual_items',
          'id, product_no, barcode, item_name, china_option, price_cny, customs_category, size_code, arrival_qty',
          'id',
          manualItemIds
        )
      : [];
    const manualItems = new Map<string, ManualItemRow>();
    for (const m of manualRows) manualItems.set(m.id, m);

    // ── 2b) 세트상품 단가 합산: product_id별 SUM(price_cny) + 배송비(1회, order_qty로 나눔) ──
    const setProductIds = [...new Set(
      oiRows.filter((r) => (r.set_total ?? 0) > 1 && r.product_id).map((r) => r.product_id!)
    )];

    const setPriceMap = new Map<string, number>(); // product_id → 합산 단가

    if (setProductIds.length > 0) {
      const setRows = await batchIn<{
        product_id: string; price_cny: number | null; price_delivery_cny: number | null; order_qty: number | null;
      }>('ft_order_items', 'product_id, price_cny, price_delivery_cny, order_qty', 'product_id', setProductIds);

      // price_cny 합산 + 배송비는 product_id당 1회만 (order_qty로 나눔)
      const setCnySumMap = new Map<string, number>();
      const setDeliveryMap = new Map<string, number>();

      for (const s of setRows) {
        setCnySumMap.set(s.product_id, (setCnySumMap.get(s.product_id) ?? 0) + (s.price_cny ?? 0));
        if (!setDeliveryMap.has(s.product_id)) {
          setDeliveryMap.set(s.product_id, (s.price_delivery_cny ?? 0) / (s.order_qty ?? 1));
        }
      }

      for (const [pid, cnySum] of setCnySumMap) {
        const deliveryPerUnit = setDeliveryMap.get(pid) ?? 0;
        setPriceMap.set(pid, Math.round((cnySum + deliveryPerUnit) * 100) / 100);
      }
    }

    // ── 3) inbound(ARRIVAL/RETURN) + outbound(PACKED) 이력 조회 → available_qty 계산 ──
    //
    // 출고가능수량 공식 (raw):
    //   available = ARRIVAL - PACKED출고완료 - RETURN
    //
    //   - CANCEL 은 입고된 적 없으니 재고 영향 없음 → 차감하지 않음
    //   - RETURN 은 입고된 것 중 일부를 돌려보낸 것 → 재고 차감
    //   - 부자재는 입고 이력이 없으므로 ft_shipment_manual_items.arrival_qty 를 ARRIVAL 로 본다
    const [inboundFf, outboundFf, manualOutboundFf] = await Promise.all([
      orderItemIds.length > 0
        ? batchIn<{ id: string; order_item_id: string; quantity: number; type: string }>(
            'ft_fulfillment_inbounds', 'id, order_item_id, quantity, type', 'order_item_id', orderItemIds
          )
        : Promise.resolve([]),
      orderItemIds.length > 0
        ? batchIn<{ id: string; order_item_id: string; quantity: number; type: string; shipment_id: string | null }>(
            'ft_fulfillment_outbounds', 'id, order_item_id, quantity, type, shipment_id', 'order_item_id', orderItemIds
          )
        : Promise.resolve([]),
      manualItemIds.length > 0
        ? batchIn<{ id: string; manual_item_id: string; quantity: number; type: string; shipment_id: string | null }>(
            'ft_fulfillment_outbounds', 'id, manual_item_id, quantity, type, shipment_id', 'manual_item_id', manualItemIds
          )
        : Promise.resolve([]),
    ]);

    // 수량 맵 키: 일반 = order_item_id / 부자재 = 'manual:' + manual_item_id
    const manualKey = (id: string) => `manual:${id}`;
    const qtyKeyOf = (f: { order_item_id: string | null; manual_item_id: string | null }): string =>
      f.order_item_id ?? (f.manual_item_id ? manualKey(f.manual_item_id) : '');

    // available = ARRIVAL - PACKED출고완료 - RETURN
    const availableMap = new Map<string, number>();
    // 전체 출고준비 수량 (PACKED + shipment_id 미배정, 상품 기준 합)
    const totalPackedMap = new Map<string, number>();
    const add = (map: Map<string, number>, key: string, n: number) =>
      map.set(key, (map.get(key) ?? 0) + n);

    for (const f of inboundFf) {
      if (f.type === 'ARRIVAL') add(availableMap, f.order_item_id, f.quantity);
      else if (f.type === 'RETURN') add(availableMap, f.order_item_id, -f.quantity);
      // CANCEL 은 재고 영향 없음 (입고된 적 없음) → 무시
    }
    for (const m of manualRows) add(availableMap, manualKey(m.id), m.arrival_qty);

    const packedRows = [
      ...outboundFf.map((f) => ({ key: f.order_item_id, ...f })),
      ...manualOutboundFf.map((f) => ({ key: manualKey(f.manual_item_id), ...f })),
    ];
    for (const f of packedRows) {
      if (f.type !== 'PACKED') continue;
      if (f.shipment_id != null) add(availableMap, f.key, -f.quantity);
      else add(totalPackedMap, f.key, f.quantity);
    }

    // ── 4) ft_box_info: 사이즈·타입·합배송 마스터 ──
    //   박스코드는 출고 후 재사용되므로 box_info_id 로 조회한다.
    //   box_info_id 가 없는 과거 출고 행(149건, 2026-10-29)만 box_code 로 보조 조회.
    const boxInfoIds = uniq(fulfillments.map((f) => f.box_info_id));
    const legacyBoxCodes = uniq(fulfillments.filter((f) => !f.box_info_id).map((f) => f.box_code));
    const BOX_SELECT = 'id, box_code, type, size, master_box_id, master_box_code';

    const [boxById, boxByCodeRows] = await Promise.all([
      boxInfoIds.length > 0 ? batchIn<BoxInfoRow>('ft_box_info', BOX_SELECT, 'id', boxInfoIds) : Promise.resolve([]),
      legacyBoxCodes.length > 0
        ? batchIn<BoxInfoRow>('ft_box_info', BOX_SELECT, 'box_code', legacyBoxCodes, [{ column: 'user_id', op: 'eq', value: userId }])
        : Promise.resolve([]),
    ]);

    const boxMap = new Map<string, BoxInfoRow>();
    for (const b of boxById) boxMap.set(b.id, b);
    const boxByCode = new Map<string, BoxInfoRow>();
    for (const b of boxByCodeRows) boxByCode.set(b.box_code, b);

    // 마스터 박스 타입 (합배송 판정용) — 목록에 없는 마스터만 추가 조회
    const masterIds = uniq([...boxMap.values(), ...boxByCode.values()].map((b) => b.master_box_id))
      .filter((id) => !boxMap.has(id));
    const masterRows = masterIds.length > 0
      ? await batchIn<{ id: string; type: string | null }>('ft_box_info', 'id, type', 'id', masterIds)
      : [];
    const boxTypeById = new Map<string, string | null>();
    for (const b of boxMap.values()) boxTypeById.set(b.id, b.type);
    for (const b of masterRows) boxTypeById.set(b.id, b.type);

    // ── 5) 쉽먼트사이즈: barcode → ft_cp_item → ft_cp_shipment_size ──
    const barcodes = uniq(oiRows.map((r) => r.barcode));
    const sizeMap: Record<string, string | null> = {};

    if (barcodes.length > 0) {
      const cpItems = await batchIn<{ barcode: string; option_id: string }>(
        'ft_cp_item', 'barcode, option_id', 'barcode', barcodes
      );

      if (cpItems.length > 0) {
        const optionIds = uniq(cpItems.map((c) => c.option_id));
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

    // ── 6) 품목 영문명 + 미처리 이동요청 (미출고 목록일 때만) ──
    const [customsEnMap, moveRequests] = await Promise.all([
      loadCustomsCategoryEnMap(),
      shipmentId
        ? Promise.resolve([] as MoveRequestRow[])
        : batchIn<MoveRequestRow>(
            'ft_move_requests',
            'id, outbound_id, target_type, from_box_code, requested_by, requested_at',
            'outbound_id',
            fulfillments.map((f) => f.id),
            [{ column: 'status', op: 'eq', value: 'REQUESTED' }]
          ),
    ]);
    const moveRequestMap = new Map<string, MoveRequestRow>();
    for (const r of moveRequests) moveRequestMap.set(r.outbound_id, r);

    // ── 7) 개별 fulfillment 행 + 조인 결과 구성 (병합 없음, 1:1) ──
    const result = fulfillments.map((ff) => {
      const oi = ff.order_item_id ? orderItems[ff.order_item_id] : undefined;
      const manual = ff.manual_item_id ? manualItems.get(ff.manual_item_id) : undefined;
      const qtyKey = qtyKeyOf(ff);
      const box = ff.box_info_id ? boxMap.get(ff.box_info_id) : (ff.box_code ? boxByCode.get(ff.box_code) : undefined);
      const masterType = box?.master_box_id ? (boxTypeById.get(box.master_box_id) ?? null) : null;
      const moveReq = moveRequestMap.get(ff.id);

      // ── 상품 정보: 일반 주문 / 부자재 ──
      let barcode: string | null = null;
      let totalPrice: number | null = null;
      let customsCategory: string | null = null;
      let sizeCode: string | null = null;
      if (manual) {
        barcode = manual.barcode;
        totalPrice = manual.price_cny;
        customsCategory = manual.customs_category;
        sizeCode = manual.size_code;
      } else if (oi) {
        barcode = oi.barcode || null;
        customsCategory = oi.customs_category || null;
        // 박스 적합 판정용 사이즈 코드 — 상품출고 V2 스캔 검증과 같은 기준(주문의 shipment_type)
        sizeCode = resolveScanSizeCode(oi.shipment_type, oi.coupang_shipment_size);
        // 단가 계산: 세트상품이면 product_id별 합산, 일반상품이면 price_cny + price_delivery_cny/order_qty
        if ((oi.set_total ?? 0) > 1 && oi.product_id) {
          totalPrice = setPriceMap.get(oi.product_id) ?? null;
        } else {
          totalPrice = Math.round(((oi.price_cny ?? 0) + (oi.price_delivery_cny ?? 0) / (oi.order_qty ?? 1)) * 100) / 100;
        }
      }

      return {
        id: ff.id,
        box_code: ff.box_code,
        box_info_id: box?.id ?? ff.box_info_id ?? null,
        box_size: box?.size || null,
        master_box_id: box?.master_box_id || null,
        master_box_code: box?.master_box_code || null,
        /** 합배송이면 마스터 박스 타입, 아니면 자기 박스 타입 (이동요청 처리 판정과 같은 기준) */
        effective_box_type: masterType ?? box?.type ?? null,
        order_item_id: ff.order_item_id,
        manual_item_id: ff.manual_item_id,
        quantity: ff.quantity,
        total_qty: totalPackedMap.get(qtyKey) ?? 0,
        available_qty: availableMap.get(qtyKey) ?? 0,
        shipment_size: manual ? manual.size_code : (barcode ? (sizeMap[barcode] ?? null) : null),
        size_code: sizeCode,
        product_no: ff.product_no || oi?.product_no || manual?.product_no || null,
        barcode,
        item_name: manual ? manual.item_name : (oi?.item_name || null),
        option_name: manual ? null : (oi?.option_name || null),
        china_option1: manual ? manual.china_option : (oi?.china_option1 || null),
        china_option2: manual ? null : (oi?.china_option2 || null),
        price_cny: totalPrice,
        img_url: oi?.img_url || null,
        composition: oi?.composition || null,
        customs_category: customsCategory,
        customs_category_en: toCustomsCategoryEn(customsCategory, customsEnMap),
        shipment_no: ff.shipment_no || null,
        vendor_option_id: oi?.vendor_option_id || null,
        move_request: moveReq
          ? {
              id: moveReq.id,
              target_type: moveReq.target_type,
              from_box_code: moveReq.from_box_code,
              requested_by: moveReq.requested_by,
              requested_at: moveReq.requested_at,
            }
          : null,
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

    // PACKED 레코드 → ft_fulfillment_outbounds 에서 업데이트
    let count = 0;
    await Promise.all(
      updates.map(async (u: { id: string; fields: Record<string, unknown> }) => {
        const { error } = await supabase
          .from('ft_fulfillment_outbounds')
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
