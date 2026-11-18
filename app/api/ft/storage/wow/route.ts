import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError, fetchAll, fetchIn, userFilter, fetchProductInfo } from '../storageShared';
import type { PickInput, WowLine } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/storage/wow — 와우출고 (supabase/storage/005_wow.sql)
//
//   GET [?user_id=] : 출고 전 줄이 남은 발주서의 줄 전부 (ft_wow_order_state(NULL) 과 같은 기준)
//     박스 출고 = 묶인 1688 박스의 포장 행이 전부 shipment_id 를 가짐 (ft_box_info.shipment_id 는 쓰지 않는다)
//   POST { action: 'pick',   user_id, wow_box_id, box_info_id, lines: [{ item_id, picks: [{ location_id, qty }] }], operator_name }
//        { action: 'unpack', user_id, wow_box_id, operator_name }
//     → rpc ft_wow_pick / ft_wow_unpack. 오류 코드는 storageShared 문구로 409
// ============================================================

interface BoxRow {
  id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  box_size: string | null;
  box_info_id: string | null;
  label_path: string | null;
  manifest_path: string | null;
}

interface ItemRow {
  id: string;
  order_number: string;
  wow_box_id: string | null;
  barcode: string;
  product_id: string;
  qty: number;
  picked_qty: number | null;
  picked_at: string | null;
}

export async function GET(request: NextRequest) {
  const filter = userFilter(request.nextUrl.searchParams.get('user_id'));

  try {
    const [boxes, items] = await Promise.all([
      fetchAll<BoxRow>('ft_wow_boxes',
        'id, order_number, box_no, center, box_size, box_info_id, label_path, manifest_path', ['id'], filter),
      fetchAll<ItemRow>('ft_wow_items',
        'id, order_number, wow_box_id, barcode, product_id, qty, picked_qty, picked_at', ['id'], filter),
    ]);
    if (items.length === 0) return NextResponse.json({ success: true, data: [] });

    const boundIds = boxes.map((b) => b.box_info_id ?? '').filter(Boolean);
    const [info, boxInfos, packed] = await Promise.all([
      fetchProductInfo(items.map((i) => i.product_id)),
      fetchIn<{ id: string; box_code: string | null }>('ft_box_info', 'id, box_code', 'id', boundIds),
      fetchIn<{ id: string; box_info_id: string; shipment_id: string | null }>(
        'ft_fulfillment_outbounds', 'id, box_info_id, shipment_id', 'box_info_id', boundIds),
    ]);

    // ── 박스 출고 판정 ──
    const unshipped = new Set(packed.filter((o) => !o.shipment_id).map((o) => o.box_info_id));
    const hasRows = new Set(packed.map((o) => o.box_info_id));
    const codeById = new Map(boxInfos.map((b) => [b.id, b.box_code]));
    const boxById = new Map(boxes.map((b) => [b.id, b]));
    const shippedBox = (b: BoxRow | undefined) =>
      !!b?.box_info_id && hasRows.has(b.box_info_id) && !unshipped.has(b.box_info_id);

    // ── 출고 전 줄이 남은 발주서만 ──
    const openOrders = new Set(
      items.filter((i) => !shippedBox(i.wow_box_id ? boxById.get(i.wow_box_id) : undefined)).map((i) => i.order_number)
    );

    const data: WowLine[] = [];
    for (const i of items) {
      const p = info.get(i.product_id);
      if (!p || !openOrders.has(i.order_number)) continue;
      const b = i.wow_box_id ? boxById.get(i.wow_box_id) : undefined;
      data.push({
        ...p,
        item_id: i.id,
        order_number: i.order_number,
        wow_barcode: i.barcode,
        qty: i.qty,
        picked_qty: i.picked_qty,
        picked_at: i.picked_at,
        box_id: b?.id ?? null,
        box_no: b?.box_no ?? null,
        center: b?.center ?? null,
        box_size: b?.box_size ?? null,
        box_info_id: b?.box_info_id ?? null,
        box_code: b?.box_info_id ? codeById.get(b.box_info_id) ?? null : null,
        label_path: b?.label_path ?? null,
        manifest_path: b?.manifest_path ?? null,
        shipped: shippedBox(b),
      });
    }
    data.sort((a, b) =>
      a.order_number.localeCompare(b.order_number) || (a.box_no ?? 0) - (b.box_no ?? 0) || a.wow_barcode.localeCompare(b.wow_barcode));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('와우출고 조회', error);
  }
}

interface WowPickLine { item_id: string; picks: PickInput[] }

export async function POST(request: NextRequest) {
  try {
    const { action, user_id, wow_box_id, box_info_id, lines, operator_name } = await request.json();

    if (!user_id || !wow_box_id) return fail('user_id, wow_box_id 가 필요합니다.');
    if (!operator_name) return fail('담당자를 선택해 주세요.');

    let rpc;
    if (action === 'pick') {
      if (!box_info_id) return fail('박스를 선택해 주세요.');
      const list = (Array.isArray(lines) ? lines : []) as WowPickLine[];
      if (list.length === 0 || list.some((l) => !l?.item_id || !Array.isArray(l.picks)
        || l.picks.some((p) => !p?.location_id || !Number.isInteger(p.qty) || p.qty < 1))) {
        return fail('위치별 수량을 1 이상으로 입력해 주세요.');
      }
      rpc = supabase.rpc('ft_wow_pick', {
        p_user_id: user_id,
        p_wow_box_id: wow_box_id,
        p_box_info_id: box_info_id,
        p_lines: list.map((l) => ({ item_id: l.item_id, picks: l.picks.map((p) => ({ location_id: p.location_id, qty: p.qty })) })),
        p_operator_name: operator_name,
      });
    } else if (action === 'unpack') {
      rpc = supabase.rpc('ft_wow_unpack', { p_user_id: user_id, p_wow_box_id: wow_box_id, p_operator_name: operator_name });
    } else {
      return fail('action 은 pick 또는 unpack 입니다.');
    }

    const { data, error } = await rpc;
    if (error) {
      const e = toStorageError(error.message);
      if (e.code !== 'UNKNOWN') {
        return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
  } catch (error) {
    return serverError('와우출고 담기', error);
  }
}
