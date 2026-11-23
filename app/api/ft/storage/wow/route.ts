import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError, fetchAll, fetchIn, userFilter, fetchProductInfo, fetchLocationCodes } from '../storageShared';
import type { WowAlloc, WowLine } from '../../../../storage/types';
import { WOW_SHIPPED_VISIBLE_DAYS, wowStageOf } from '../../../../storage/utils/wowStage';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/storage/wow — 와우출고 (supabase/storage/005 ~ 010)
//
//   GET [?user_id=] : 출고 전 줄 전부 + 출고한 지 WOW_SHIPPED_VISIBLE_DAYS 일 안 된 박스의 줄
//     · 줄마다 단계(stage)를 계산해 내려준다 — 판정은 app/storage/utils/wowStage.ts 한 곳
//     · 담지 않은 박스의 줄에는 꺼낼 선반(allocs)을 붙인다 — 저장된 선반 배정 그대로 (011_wow_alloc.sql)
//     · 박스 출고 = 그 박스 줄들이 가리키는 포장 행(ft_wow_items.outbound_id)이 전부 shipment_id 를 가짐
//       (마킹 상자는 [출고준비완료] 때 정해지고 마대면 여러 박스가 한 상자를 쓴다 — 박스 단위로는 줄의 포장 행을 본다)
//       출고 시각 = 그 쉽먼트들의 생성 시각 중 가장 늦은 것 (ft_wow_order_state 와 같은 기준)
//   POST { action, operator_name, … }
//     박스 하나 — + user_id, wow_box_id
//       cancel : [작업 취소]     작업중 → 신규           rpc ft_wow_work_cancel (모바일 작업 기록도 지운다)
//       unpack : [작업완료 취소]  작업완료 · 서류준비 → 작업중  rpc ft_wow_unpack
//     박스 여러 개 — + wow_box_ids (하나라도 안 맞으면 전부 거절)
//       label_printed : [라벨출력] 기록                       박스 라벨을 뽑은 시각
//       seq        : [순서지정] 저장   서류준비 → 순서지정     rpc ft_wow_seq_set (보낸 순서 = 실을 순서, 저장 = 전체 교체)
//                    번호는 합포장 · 출고준비에 있는 출고 전 박스의 가장 큰 번호 다음부터 이어진다
//       seq_clear  : [초기화]         순서지정 → 서류준비     rpc ft_wow_seq_clear
//       attach     : [부착완료]       순서지정 → 합포장       rpc ft_wow_attach_set(true)
//       attach_clear : [부착완료 취소] 합포장 → 순서지정      rpc ft_wow_attach_set(false) (마대 · 그대로 출고를 정하기 전에만)
//       pack       : [합포장]         마대 · 그대로 출고 정함  rpc ft_wow_pack_set + bag: 'new' | 마대 id | null(그대로 출고)
//       pack_clear : [합포장 취소]     정한 것을 푼다          rpc ft_wow_pack_clear (합포장 단계에 남는다)
//       ready      : [출고준비완료]    합포장 → 출고준비       rpc ft_wow_ready_pack (마킹번호를 붙인다)
//       unready    : [출고준비 취소]   출고준비 → 합포장       rpc ft_wow_ready_set(false) (출고 전에만. 마킹번호는 그대로)
//     작업(신규 → 작업중 → 작업완료)은 모바일 화면이 한다: /api/ft/storage/wow/work
//     오류 코드는 storageShared 문구로 409
// ============================================================

const DAY_MS = 86_400_000;
/** 한 번에 처리할 수 있는 박스 수 */
const MAX_BOXES = 500;
const ID_CHUNK = 100;

interface BoxRow {
  id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  arrival_date: string | null;
  box_size: string | null;
  packed_box_size: string | null;
  order_box_total: number | null;
  box_info_id: string | null;
  label_path: string | null;
  manifest_path: string | null;
  label_printed_at: string | null;
  work_started_at: string | null;
  work_started_by: string | null;
  picked_at: string | null;
  picked_by: string | null;
  ship_seq: number | null;
  ship_seq_at: string | null;
  ship_seq_by: string | null;
  attached_at: string | null;
  attached_by: string | null;
  packed_at: string | null;
  packed_by: string | null;
  bag_id: string | null;
  ready_at: string | null;
  ready_by: string | null;
}

const BOX_SELECT =
  'id, order_number, box_no, center, arrival_date, box_size, packed_box_size, order_box_total, box_info_id, label_path, manifest_path, ' +
  'label_printed_at, work_started_at, work_started_by, picked_at, picked_by, ship_seq, ship_seq_at, ship_seq_by, ' +
  'attached_at, attached_by, packed_at, packed_by, bag_id, ready_at, ready_by';

interface ItemRow {
  id: string;
  order_number: string;
  wow_box_id: string | null;
  barcode: string;
  product_id: string;
  qty: number;
  picked_qty: number | null;
  picked_at: string | null;
  outbound_id: string | null;
}

interface PackedRow {
  id: string;
  shipment_id: string | null;
  shipment_no: string | null;
}

interface FindRow {
  id: string;
  wow_box_id: string;
  product_id: string;
  location_id: string | null;
  plan_qty: number;
  found_qty: number | null;
}

/** 와우 박스 하나의 출고 상태 */
interface ShipState {
  shipped: boolean;
  shipped_at: string | null;
  shipment_no: string | null;
}

const NOT_SHIPPED: ShipState = { shipped: false, shipped_at: null, shipment_no: null };

// ── 와우 박스별 출고 상태 — 줄이 가리키는 포장 행이 있고 전부 출고됐을 때만 출고 ──
async function loadShipStates(items: ItemRow[]): Promise<Map<string, ShipState>> {
  const packed = await fetchIn<PackedRow>(
    'ft_fulfillment_outbounds', 'id, shipment_id, shipment_no', 'id', items.map((i) => i.outbound_id ?? ''));
  const shipments = await fetchIn<{ id: string; created_at: string }>(
    'ft_shipments', 'id, created_at', 'id', packed.map((o) => o.shipment_id ?? ''));
  const createdAt = new Map(shipments.map((s) => [s.id, s.created_at]));
  const packedById = new Map(packed.map((o) => [o.id, o]));

  const rowsByBox = new Map<string, PackedRow[]>();
  for (const i of items) {
    const row = i.outbound_id ? packedById.get(i.outbound_id) : undefined;
    if (!i.wow_box_id || !row) continue;
    const arr = rowsByBox.get(i.wow_box_id) ?? [];
    arr.push(row);
    rowsByBox.set(i.wow_box_id, arr);
  }

  const states = new Map<string, ShipState>();
  for (const [boxId, rows] of rowsByBox) {
    if (rows.some((o) => !o.shipment_id)) continue;
    const times = rows.map((o) => createdAt.get(o.shipment_id ?? '') ?? '').filter(Boolean).sort();
    const numbers = rows.map((o) => o.shipment_no ?? '').filter(Boolean).sort();
    states.set(boxId, {
      shipped: true,
      shipped_at: times[times.length - 1] ?? null,
      shipment_no: numbers[numbers.length - 1] ?? null,
    });
  }
  return states;
}

// ── 담지 않은 박스의 선반 배정 — `${박스 id}|${상품 id}` → 선반 코드 순 (선반 없는 몫은 맨 뒤) ──
async function loadAllocs(boxes: BoxRow[]): Promise<Map<string, WowAlloc[]>> {
  const finds = await fetchIn<FindRow>(
    'ft_wow_finds', 'id, wow_box_id, product_id, location_id, plan_qty, found_qty', 'wow_box_id',
    boxes.filter((b) => !b.picked_at).map((b) => b.id));
  const codes = await fetchLocationCodes(finds.map((f) => f.location_id ?? ''));

  const out = new Map<string, WowAlloc[]>();
  for (const f of finds) {
    // 표시 전인데 몫이 0 인 줄(메모만 남은 줄)은 배정이 아니다
    if (f.found_qty === null && f.plan_qty === 0) continue;
    const key = `${f.wow_box_id}|${f.product_id}`;
    const list = out.get(key) ?? [];
    list.push({ location_code: f.location_id ? codes.get(f.location_id) ?? '?' : null, plan_qty: f.plan_qty, found_qty: f.found_qty });
    out.set(key, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) =>
      Number(a.location_code === null) - Number(b.location_code === null)
      || String(a.location_code).localeCompare(String(b.location_code)));
  }
  return out;
}

export async function GET(request: NextRequest) {
  const filter = userFilter(request.nextUrl.searchParams.get('user_id'));

  try {
    const [boxes, items] = await Promise.all([
      fetchAll<BoxRow>('ft_wow_boxes', BOX_SELECT, ['id'], filter),
      fetchAll<ItemRow>('ft_wow_items',
        'id, order_number, wow_box_id, barcode, product_id, qty, picked_qty, picked_at, outbound_id', ['id'], filter),
    ]);
    if (items.length === 0) return NextResponse.json({ success: true, data: [] });

    const [info, boxInfos, bags, shipStates, allocs] = await Promise.all([
      fetchProductInfo(items.map((i) => i.product_id)),
      fetchIn<{ id: string; box_code: string | null }>('ft_box_info', 'id, box_code', 'id', boxes.map((b) => b.box_info_id ?? '')),
      fetchIn<{ id: string; bag_no: number }>('ft_wow_bags', 'id, bag_no', 'id', boxes.map((b) => b.bag_id ?? '')),
      loadShipStates(items),
      loadAllocs(boxes),
    ]);

    const codeById = new Map(boxInfos.map((b) => [b.id, b.box_code]));
    const bagNoById = new Map(bags.map((g) => [g.id, g.bag_no]));
    const boxById = new Map(boxes.map((b) => [b.id, b]));

    // ── 출고한 지 오래된 박스는 목록에서 뺀다 (출고 시각을 모르면 남긴다) ──
    const cutoff = Date.now() - WOW_SHIPPED_VISIBLE_DAYS * DAY_MS;
    const expired = (s: ShipState) => s.shipped && !!s.shipped_at && Date.parse(s.shipped_at) < cutoff;

    const data: WowLine[] = [];
    for (const i of items) {
      const p = info.get(i.product_id);
      if (!p) continue;
      const b = i.wow_box_id ? boxById.get(i.wow_box_id) : undefined;
      const ship = (b ? shipStates.get(b.id) : undefined) ?? NOT_SHIPPED;
      if (expired(ship)) continue;

      const stageFields = {
        box_picked_at: b?.picked_at ?? null,
        work_started_at: b?.work_started_at ?? null,
        label_path: b?.label_path ?? null,
        manifest_path: b?.manifest_path ?? null,
        ship_seq: b?.ship_seq ?? null,
        attached_at: b?.attached_at ?? null,
        ready_at: b?.ready_at ?? null,
        shipped: ship.shipped,
      };
      data.push({
        ...p,
        ...stageFields,
        stage: wowStageOf(stageFields),
        item_id: i.id,
        order_number: i.order_number,
        wow_barcode: i.barcode,
        qty: i.qty,
        picked_qty: i.picked_qty,
        picked_at: i.picked_at,
        allocs: (b ? allocs.get(`${b.id}|${i.product_id}`) : undefined) ?? [],
        box_id: b?.id ?? null,
        box_no: b?.box_no ?? null,
        center: b?.center ?? null,
        arrival_date: b?.arrival_date ?? null,
        box_size: b?.packed_box_size ?? b?.box_size ?? null,
        order_box_total: b?.order_box_total ?? null,
        label_printed_at: b?.label_printed_at ?? null,
        box_info_id: b?.box_info_id ?? null,
        box_code: b?.box_info_id ? codeById.get(b.box_info_id) ?? null : null,
        work_started_by: b?.work_started_by ?? null,
        picked_by: b?.picked_by ?? null,
        ship_seq_at: b?.ship_seq_at ?? null,
        ship_seq_by: b?.ship_seq_by ?? null,
        attached_by: b?.attached_by ?? null,
        packed_at: b?.packed_at ?? null,
        packed_by: b?.packed_by ?? null,
        bag_id: b?.bag_id ?? null,
        bag_no: b?.bag_id ? bagNoById.get(b.bag_id) ?? null : null,
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

// ============================================================
// POST — 단계 옮기기
// ============================================================

const BULK_ACTIONS = ['label_printed', 'seq', 'seq_clear', 'attach', 'attach_clear', 'pack', 'pack_clear', 'ready', 'unready'] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];
const isBulk = (action: unknown): action is BulkAction => BULK_ACTIONS.includes(action as BulkAction);

/** [라벨출력] 기록 — 박스 라벨을 뽑은 시각 (단계는 바뀌지 않는다) */
async function markLabelPrinted(ids: string[], operatorName: string) {
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { error } = await supabase.from('ft_wow_boxes')
      .update({ label_printed_at: now, label_printed_by: operatorName })
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, user_id, wow_box_id, wow_box_ids, bag, operator_name } = await request.json();

    if (!operator_name) return fail('담당자를 선택해 주세요.');

    let rpc;
    if (isBulk(action)) {
      // 순서지정은 보낸 순서가 곧 실을 순서다 — 순서를 바꾸지 않는다
      const ids = Array.isArray(wow_box_ids) ? wow_box_ids.filter((v): v is string => typeof v === 'string' && !!v) : [];
      if (ids.length === 0) return fail('박스를 선택해 주세요.');
      if (ids.length > MAX_BOXES) return fail(`한 번에 ${MAX_BOXES}박스까지 처리할 수 있습니다.`);
      const args = { p_wow_box_ids: ids, p_operator_name: operator_name };

      if (action === 'label_printed') {
        await markLabelPrinted(ids, operator_name);
        return NextResponse.json({ success: true, count: ids.length });
      }
      if (action === 'seq') rpc = supabase.rpc('ft_wow_seq_set', args);
      else if (action === 'seq_clear') rpc = supabase.rpc('ft_wow_seq_clear', args);
      else if (action === 'attach' || action === 'attach_clear') {
        rpc = supabase.rpc('ft_wow_attach_set', { ...args, p_attached: action === 'attach' });
      }
      else if (action === 'pack') {
        if (bag !== null && bag !== undefined && typeof bag !== 'string') return fail('bag 은 new · 마대 id · null 중 하나입니다.');
        rpc = supabase.rpc('ft_wow_pack_set', {
          ...args,
          p_bag_id: bag && bag !== 'new' ? bag : null,
          p_new_bag: bag === 'new',
        });
      }
      else if (action === 'pack_clear') rpc = supabase.rpc('ft_wow_pack_clear', args);
      else if (action === 'ready') rpc = supabase.rpc('ft_wow_ready_pack', args);
      else rpc = supabase.rpc('ft_wow_ready_set', { ...args, p_ready: false });
    } else if (action === 'cancel' || action === 'unpack') {
      if (!user_id || !wow_box_id) return fail('user_id, wow_box_id 가 필요합니다.');
      rpc = supabase.rpc(action === 'cancel' ? 'ft_wow_work_cancel' : 'ft_wow_unpack',
        { p_user_id: user_id, p_wow_box_id: wow_box_id, p_operator_name: operator_name });
    } else {
      return fail(`action 은 cancel · unpack · ${BULK_ACTIONS.join(' · ')} 중 하나입니다.`);
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
