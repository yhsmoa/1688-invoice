import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError, fetchAll, fetchIn, userFilter, fetchProductInfo } from '../storageShared';
import type { PickInput, WowLine } from '../../../../storage/types';
import { WOW_SHIPPED_VISIBLE_DAYS, wowStageOf } from '../../../../storage/utils/wowStage';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/storage/wow — 와우출고 (supabase/storage/005_wow.sql · 006_wow_stage.sql · 008_wow_ready.sql)
//
//   GET [?user_id=] : 출고 전 줄 전부 + 출고한 지 WOW_SHIPPED_VISIBLE_DAYS 일 안 된 박스의 줄
//     · 줄마다 단계(stage)를 계산해 내려준다 — 판정은 app/storage/utils/wowStage.ts 한 곳
//     · 박스 출고 = 묶인 1688 박스의 포장 행이 전부 shipment_id 를 가짐 (ft_box_info.shipment_id 는 쓰지 않는다)
//       출고 시각 = 그 쉽먼트들의 생성 시각 중 가장 늦은 것 (ft_wow_order_state 와 같은 기준)
//   POST { action, operator_name, … }
//     박스 하나 — + user_id, wow_box_id
//       start  : [작업]         신규 → 작업중        rpc ft_wow_work_start
//       cancel : [작업 취소]    작업중 → 신규        rpc ft_wow_work_cancel
//       pick   : [작업완료]     작업중 → 작업완료    rpc ft_wow_pick   + box_info_id, lines: [{ item_id, picks: [{ location_id, qty }] }]
//       unpack : [작업완료 취소] 작업완료 → 작업중    rpc ft_wow_unpack (출고준비 · 출고 전에만)
//     박스 여러 개 — + wow_box_ids (하나라도 안 맞으면 전부 거절)
//       ready   : [출고준비완료] 서류준비 → 출고준비  rpc ft_wow_ready_set(true)
//       unready : [출고준비 취소] 출고준비 → 서류준비  rpc ft_wow_ready_set(false) (출고 전에만)
//     오류 코드는 storageShared 문구로 409
// ============================================================

const DAY_MS = 86_400_000;
/** 한 번에 출고준비 처리할 수 있는 박스 수 */
const MAX_READY_BOXES = 500;

interface BoxRow {
  id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  arrival_date: string | null;
  box_size: string | null;
  box_info_id: string | null;
  label_path: string | null;
  manifest_path: string | null;
  work_started_at: string | null;
  work_started_by: string | null;
  picked_by: string | null;
  ready_at: string | null;
  ready_by: string | null;
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

interface PackedRow {
  id: string;
  box_info_id: string;
  shipment_id: string | null;
  shipment_no: string | null;
}

/** 묶인 1688 박스 하나의 출고 상태 */
interface ShipState {
  shipped: boolean;
  shipped_at: string | null;
  shipment_no: string | null;
}

const NOT_SHIPPED: ShipState = { shipped: false, shipped_at: null, shipment_no: null };

// ── 묶인 1688 박스별 출고 상태 — 포장 행이 있고 전부 출고됐을 때만 출고 ──
async function loadShipStates(boundIds: string[]): Promise<Map<string, ShipState>> {
  const packed = await fetchIn<PackedRow>(
    'ft_fulfillment_outbounds', 'id, box_info_id, shipment_id, shipment_no', 'box_info_id', boundIds);
  const shipments = await fetchIn<{ id: string; created_at: string }>(
    'ft_shipments', 'id, created_at', 'id', packed.map((o) => o.shipment_id ?? ''));
  const createdAt = new Map(shipments.map((s) => [s.id, s.created_at]));

  const rowsByBox = new Map<string, PackedRow[]>();
  for (const o of packed) {
    const arr = rowsByBox.get(o.box_info_id) ?? [];
    arr.push(o);
    rowsByBox.set(o.box_info_id, arr);
  }

  const states = new Map<string, ShipState>();
  for (const [boxInfoId, rows] of rowsByBox) {
    if (rows.some((o) => !o.shipment_id)) continue;
    const times = rows.map((o) => createdAt.get(o.shipment_id ?? '') ?? '').filter(Boolean).sort();
    const numbers = rows.map((o) => o.shipment_no ?? '').filter(Boolean).sort();
    states.set(boxInfoId, {
      shipped: true,
      shipped_at: times[times.length - 1] ?? null,
      shipment_no: numbers[numbers.length - 1] ?? null,
    });
  }
  return states;
}

export async function GET(request: NextRequest) {
  const filter = userFilter(request.nextUrl.searchParams.get('user_id'));

  try {
    const [boxes, items] = await Promise.all([
      fetchAll<BoxRow>('ft_wow_boxes',
        'id, order_number, box_no, center, arrival_date, box_size, box_info_id, label_path, manifest_path, ' +
        'work_started_at, work_started_by, picked_by, ready_at, ready_by', ['id'], filter),
      fetchAll<ItemRow>('ft_wow_items',
        'id, order_number, wow_box_id, barcode, product_id, qty, picked_qty, picked_at', ['id'], filter),
    ]);
    if (items.length === 0) return NextResponse.json({ success: true, data: [] });

    const boundIds = boxes.map((b) => b.box_info_id ?? '').filter(Boolean);
    const [info, boxInfos, shipStates] = await Promise.all([
      fetchProductInfo(items.map((i) => i.product_id)),
      fetchIn<{ id: string; box_code: string | null }>('ft_box_info', 'id, box_code', 'id', boundIds),
      loadShipStates(boundIds),
    ]);

    const codeById = new Map(boxInfos.map((b) => [b.id, b.box_code]));
    const boxById = new Map(boxes.map((b) => [b.id, b]));
    const shipOf = (b: BoxRow | undefined): ShipState =>
      (b?.box_info_id ? shipStates.get(b.box_info_id) : undefined) ?? NOT_SHIPPED;

    // ── 출고한 지 오래된 박스는 목록에서 뺀다 (출고 시각을 모르면 남긴다) ──
    const cutoff = Date.now() - WOW_SHIPPED_VISIBLE_DAYS * DAY_MS;
    const expired = (s: ShipState) => s.shipped && !!s.shipped_at && Date.parse(s.shipped_at) < cutoff;

    const data: WowLine[] = [];
    for (const i of items) {
      const p = info.get(i.product_id);
      if (!p) continue;
      const b = i.wow_box_id ? boxById.get(i.wow_box_id) : undefined;
      const ship = shipOf(b);
      if (expired(ship)) continue;

      const boxFields = {
        box_info_id: b?.box_info_id ?? null,
        label_path: b?.label_path ?? null,
        manifest_path: b?.manifest_path ?? null,
        work_started_at: b?.work_started_at ?? null,
        ready_at: b?.ready_at ?? null,
        shipped: ship.shipped,
      };
      data.push({
        ...p,
        ...boxFields,
        stage: wowStageOf(boxFields),
        item_id: i.id,
        order_number: i.order_number,
        wow_barcode: i.barcode,
        qty: i.qty,
        picked_qty: i.picked_qty,
        picked_at: i.picked_at,
        box_id: b?.id ?? null,
        box_no: b?.box_no ?? null,
        center: b?.center ?? null,
        arrival_date: b?.arrival_date ?? null,
        box_size: b?.box_size ?? null,
        box_code: b?.box_info_id ? codeById.get(b.box_info_id) ?? null : null,
        work_started_by: b?.work_started_by ?? null,
        picked_by: b?.picked_by ?? null,
        ready_by: b?.ready_by ?? null,
        shipped_at: ship.shipped_at,
        shipment_no: ship.shipment_no,
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
    const { action, user_id, wow_box_id, wow_box_ids, box_info_id, lines, operator_name } = await request.json();

    if (!operator_name) return fail('담당자를 선택해 주세요.');

    const boxArgs = { p_user_id: user_id, p_wow_box_id: wow_box_id, p_operator_name: operator_name };
    const isBulk = action === 'ready' || action === 'unready';
    if (!isBulk && (!user_id || !wow_box_id)) return fail('user_id, wow_box_id 가 필요합니다.');

    let rpc;
    if (isBulk) {
      const ids = Array.isArray(wow_box_ids) ? wow_box_ids.filter((v): v is string => typeof v === 'string' && !!v) : [];
      if (ids.length === 0) return fail('박스를 선택해 주세요.');
      if (ids.length > MAX_READY_BOXES) return fail(`한 번에 ${MAX_READY_BOXES}박스까지 처리할 수 있습니다.`);
      rpc = supabase.rpc('ft_wow_ready_set', { p_wow_box_ids: ids, p_ready: action === 'ready', p_operator_name: operator_name });
    } else if (action === 'start') {
      rpc = supabase.rpc('ft_wow_work_start', boxArgs);
    } else if (action === 'cancel') {
      rpc = supabase.rpc('ft_wow_work_cancel', boxArgs);
    } else if (action === 'pick') {
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
      rpc = supabase.rpc('ft_wow_unpack', boxArgs);
    } else {
      return fail('action 은 start · cancel · pick · unpack · ready · unready 중 하나입니다.');
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
    return serverError('와우출고 처리', error);
  }
}
