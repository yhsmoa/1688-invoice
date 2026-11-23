import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../../lib/supabase';
import { fail, serverError, toStorageError, fetchIn, fetchProductInfo, fetchLocationCodes } from '../../storageShared';
import type { WowWorkBox, WowWorkCard, WowWorkDeck } from '../../../../../storage/types';
import { WOW_BOX_SIZES, wowStageOf } from '../../../../../storage/utils/wowStage';
import { buildWorkCards, workProgress, type WorkFind, type WorkLine, type WorkStockCell } from '../../../../../storage/utils/wowWork';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/storage/wow/work — 와우출고 모바일 작업 (/m/wow · supabase/storage/010_wow_flow.sql)
//
//   GET            : 작업할 박스 목록 (아직 담지 않은 박스 = 신규 · 작업중) — 진행(카드 수 · 찾은 수)과 함께
//   GET ?box_id=   : 그 박스의 카드 (상품 × 선반) = 저장된 선반 배정 (ft_wow_finds · 011_wow_alloc.sql).
//                    화면에서 다시 계산하지 않는다 — app/storage/utils/wowWork.ts 는 상품 정보 · 선반 코드만 붙인다
//   POST { action, box_id, operator_name, … }
//     open     : 박스 라벨을 찍고 들어옴   신규 → 작업중      rpc ft_wow_work_start (이미 작업중이면 그대로)
//     find     : [찾음] · [부족] · 취소                       rpc ft_wow_find_set  + product_id, location_id, plan_qty, found_qty(null = 취소)
//                선반 카드에서 몫보다 적게 찾으면 모자란 몫만 다른 선반에 다시 잡힌다 → 표시한 뒤에는 카드를 다시 받는다
//                보낸 plan_qty 가 저장된 몫과 다르면(그 사이 배정이 바뀜) 거절한다 → 새로고침
//     memo     : 카드 메모                                   rpc ft_wow_find_memo + product_id, location_id, plan_qty, memo('' = 지움)
//     size     : [박스 크기 변경]                             rpc ft_wow_box_size_set + box_size (WOW_BOX_SIZES 중 하나)
//     complete : [작업완료]             작업중 → 작업완료      rpc ft_wow_pick_found (찾은 수량만큼 재고에서 빠진다.
//                하나도 찾지 못한 박스도 작업완료할 수 있다 — 담은 것이 없는 박스로 끝난다)
//   건수 (2026-11-24): ft_wow_boxes 62 · ft_wow_items 201 — 그래도 조회는 전부 range 루프
//   오류 코드는 storageShared 문구로 409
// ============================================================

const PAGE = 1000;
const ID_CHUNK = 100;

interface BoxRow {
  id: string;
  user_id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  arrival_date: string | null;
  box_size: string | null;
  packed_box_size: string | null;
  work_started_at: string | null;
  work_started_by: string | null;
  picked_at: string | null;
}

const BOX_SELECT =
  'id, user_id, order_number, box_no, center, arrival_date, box_size, packed_box_size, work_started_at, work_started_by, picked_at';

interface ItemRow { id: string; wow_box_id: string; product_id: string; qty: number }
interface FindRow extends WorkFind { wow_box_id: string }
interface BalanceRow { product_id: string; location_id: string; qty: number; first_putaway_at: string | null }

// ── 아직 담지 않은 박스 (boxId 가 있으면 그 박스만 — 담았어도 준다. 부르는 쪽이 거른다) ──
async function loadBoxes(boxId: string | null): Promise<BoxRow[]> {
  const all: BoxRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('ft_wow_boxes').select(BOX_SELECT);
    q = boxId ? q.eq('id', boxId) : q.is('picked_at', null);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as BoxRow[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// ── 상품들의 위치별 재고 (뷰 ft_storage_balance, 재고 > 0) — 뷰라 id 가 없어 정렬 열을 준다 ──
async function loadBalances(productIds: string[]): Promise<BalanceRow[]> {
  const all: BalanceRow[] = [];
  const uniq = Array.from(new Set(productIds));
  for (let i = 0; i < uniq.length; i += ID_CHUNK) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('ft_storage_balance')
        .select('product_id, location_id, qty, first_putaway_at')
        .in('product_id', uniq.slice(i, i + ID_CHUNK))
        .gt('qty', 0)
        .order('product_id', { ascending: true })
        .order('location_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...((data ?? []) as BalanceRow[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return all;
}

// ── 박스들의 카드 — 박스 id → 카드 ──
async function loadCards(boxes: BoxRow[]): Promise<Map<string, WowWorkCard[]>> {
  const boxIds = boxes.map((b) => b.id);
  const [items, finds] = await Promise.all([
    fetchIn<ItemRow>('ft_wow_items', 'id, wow_box_id, product_id, qty', 'wow_box_id', boxIds),
    fetchIn<FindRow>('ft_wow_finds',
      'id, wow_box_id, product_id, location_id, plan_qty, found_qty, found_by, found_at, memo, memo_by, memo_at', 'wow_box_id', boxIds),
  ]);
  const productIds = items.map((i) => i.product_id);
  const [info, balances] = await Promise.all([fetchProductInfo(productIds), loadBalances(productIds)]);
  // 위치 코드: 재고가 있는 위치 + 이미 표시한 위치 (다 꺼내 재고가 0 이 된 위치도 카드에 코드를 보여 준다)
  const codes = await fetchLocationCodes([...balances.map((b) => b.location_id), ...finds.map((f) => f.location_id ?? '')]);

  // 위치 = 먼저 배치된 순 (PC 표의 [꺼낼 위치] 와 같은 순서)
  const cellsByProduct = new Map<string, (WorkStockCell & { at: string })[]>();
  for (const b of balances) {
    const arr = cellsByProduct.get(b.product_id) ?? [];
    arr.push({ location_id: b.location_id, location_code: codes.get(b.location_id) ?? '?', qty: b.qty, at: String(b.first_putaway_at) });
    cellsByProduct.set(b.product_id, arr);
  }
  for (const arr of cellsByProduct.values()) arr.sort((a, b) => a.at.localeCompare(b.at));
  const cellsOf = (productId: string) => cellsByProduct.get(productId) ?? [];

  const out = new Map<string, WowWorkCard[]>();
  for (const box of boxes) {
    const lines: WorkLine[] = [];
    for (const i of items) {
      const p = i.wow_box_id === box.id ? info.get(i.product_id) : undefined;
      if (p) lines.push({ product_id: i.product_id, qty: i.qty, info: p });
    }
    lines.sort((a, b) => String(a.info.product_no).localeCompare(String(b.info.product_no)) || a.product_id.localeCompare(b.product_id));
    out.set(box.id, buildWorkCards(lines, cellsOf, finds.filter((f) => f.wow_box_id === box.id), (id) => codes.get(id) ?? null));
  }
  return out;
}

const toWorkBox = (b: BoxRow, cards: WowWorkCard[]): WowWorkBox => ({
  box_id: b.id,
  user_id: b.user_id,
  order_number: b.order_number,
  box_no: b.box_no,
  center: b.center,
  arrival_date: b.arrival_date,
  // 작업자가 바꾼 크기가 있으면 그 값 (PC 화면 · 박스 라벨 · 택배엑셀과 같은 기준)
  box_size: b.packed_box_size ?? b.box_size,
  stage: wowStageOf({
    box_picked_at: b.picked_at, work_started_at: b.work_started_at,
    label_path: null, manifest_path: null, ship_seq: null, attached_at: null, ready_at: null, shipped: false,
  }),
  work_started_by: b.work_started_by,
  qty: cards.reduce((s, c) => s + c.plan_qty, 0),
  ...workProgress(cards),
});

export async function GET(request: NextRequest) {
  const boxId = request.nextUrl.searchParams.get('box_id');

  try {
    const boxes = await loadBoxes(boxId);
    if (boxId) {
      const box = boxes[0];
      if (!box) return fail(toStorageError('WOW_BOX_NOT_FOUND').message, 404);
      if (box.picked_at) {
        return NextResponse.json({ success: false, code: 'WOW_BOX_ALREADY_PICKED', error: toStorageError('WOW_BOX_ALREADY_PICKED').message }, { status: 409 });
      }
    }
    const cards = await loadCards(boxes);

    if (boxId) {
      const deck: WowWorkDeck = { box: toWorkBox(boxes[0], cards.get(boxId) ?? []), cards: cards.get(boxId) ?? [] };
      return NextResponse.json({ success: true, data: deck });
    }
    const data = boxes.map((b) => toWorkBox(b, cards.get(b.id) ?? []));
    data.sort((a, b) =>
      String(a.arrival_date ?? '9999').localeCompare(String(b.arrival_date ?? '9999'))
      || a.order_number.localeCompare(b.order_number) || a.box_no - b.box_no);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('와우출고 작업 조회', error);
  }
}

const isId = (v: unknown): v is string => typeof v === 'string' && !!v;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export async function POST(request: NextRequest) {
  try {
    const { action, box_id, operator_name, product_id, location_id, plan_qty, found_qty, memo, box_size } = await request.json();

    if (!operator_name) return fail('담당자를 선택해 주세요.');
    if (!isId(box_id)) return fail('box_id 가 필요합니다.');
    const card = { p_wow_box_id: box_id, p_product_id: product_id, p_location_id: location_id ?? null, p_plan_qty: plan_qty };

    let rpc;
    if (action === 'open') {
      const { data: box, error } = await supabase.from('ft_wow_boxes').select('id, user_id').eq('id', box_id).maybeSingle();
      if (error) throw error;
      if (!box) return fail(toStorageError('WOW_BOX_NOT_FOUND').message, 404);
      rpc = supabase.rpc('ft_wow_work_start', { p_user_id: box.user_id, p_wow_box_id: box_id, p_operator_name: operator_name });
    } else if (action === 'find') {
      if (!isId(product_id) || !isCount(plan_qty) || (found_qty !== null && !isCount(found_qty))) {
        return fail('product_id, plan_qty(0 이상), found_qty(0 이상 또는 null) 가 필요합니다.');
      }
      rpc = supabase.rpc('ft_wow_find_set', { ...card, p_found_qty: found_qty, p_operator_name: operator_name });
    } else if (action === 'memo') {
      if (!isId(product_id) || !isCount(plan_qty) || typeof memo !== 'string') {
        return fail('product_id, plan_qty(0 이상), memo 가 필요합니다.');
      }
      rpc = supabase.rpc('ft_wow_find_memo', { ...card, p_memo: memo, p_operator_name: operator_name });
    } else if (action === 'size') {
      if (typeof box_size !== 'string' || !WOW_BOX_SIZES.includes(box_size)) {
        return fail(`박스 크기는 ${WOW_BOX_SIZES.join(' / ')} 중 하나여야 합니다.`);
      }
      rpc = supabase.rpc('ft_wow_box_size_set', { p_wow_box_id: box_id, p_size: box_size, p_operator_name: operator_name });
    } else if (action === 'complete') {
      rpc = supabase.rpc('ft_wow_pick_found', { p_wow_box_id: box_id, p_operator_name: operator_name });
    } else {
      return fail('action 은 open · find · memo · size · complete 중 하나입니다.');
    }

    const { data, error } = await rpc;
    if (error) {
      const e = toStorageError(error.message);
      // 이미 작업중인 박스에 들어온 것은 오류가 아니다 (다른 폰이 먼저 시작)
      if (action === 'open' && e.code === 'WOW_WORK_ALREADY_STARTED') return NextResponse.json({ success: true });
      if (e.code !== 'UNKNOWN') {
        return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
  } catch (error) {
    return serverError('와우출고 작업 처리', error);
  }
}
