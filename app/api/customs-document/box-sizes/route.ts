import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/customs-document/box-sizes
//   통관서류 [불러오기] — 포장 행(ft_fulfillment_outbounds.id) 마다 "실제로 나가는 상자" 의 코드·사이즈
//
//   Body: { fulfillment_ids: string[] }
//   응답: { success, data: { [fulfillment_id]: { carton_code, carton_size } } }
//
//   · 박스코드는 출고 후 재사용되므로 box_code 가 아니라 outbound.box_info_id 로 박스를 찾는다
//   · 합배송된 박스(master_box_id 있음)는 마스터 박스에 담겨 나가므로 마스터의 코드·사이즈를 쓴다
//     (통관서류의 마킹 1개 = C/T 1 = 상자 1개)
//   · box_info_id 가 없는 과거 행은 응답에서 빠진다 → 화면은 행의 box_code 를 쓰고 사이즈는 비워 둔다
// ============================================================

// ── id IN 조회 (100개 단위) — id 는 유일하므로 배치당 100행을 넘지 않는다 (1000행 제한 무관) ──
const BATCH = 100;
async function selectByIds<T>(table: string, select: string, ids: string[]): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data, error } = await supabase.from(table).select(select).in('id', ids.slice(i, i + BATCH));
    if (error) throw error;
    all.push(...((data ?? []) as T[]));
  }
  return all;
}

const uniq = (values: (string | null | undefined)[]): string[] =>
  [...new Set(values.filter((v): v is string => !!v))];

interface BoxRow {
  id: string;
  box_code: string | null;
  size: string | null;
  master_box_id: string | null;
}

// 한 번에 받을 수 있는 포장 행 수 — 쉽먼트 여러 개를 합쳐도 이 안에 들어온다 (2026-10-29 미출고 전체 1,120행)
const MAX_IDS = 20000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const raw = body?.fulfillment_ids;
    if (!Array.isArray(raw) || raw.some((v: unknown) => typeof v !== 'string')) {
      return NextResponse.json({ success: false, error: 'fulfillment_ids(문자열 배열)가 필요합니다.' }, { status: 400 });
    }
    const ids = uniq(raw as string[]);
    if (ids.length > MAX_IDS) {
      return NextResponse.json({ success: false, error: `한 번에 ${MAX_IDS.toLocaleString()}행까지 조회할 수 있습니다.` }, { status: 400 });
    }
    if (ids.length === 0) return NextResponse.json({ success: true, data: {} });

    // ── 1) 포장 행 → 박스 id ──
    const outbounds = await selectByIds<{ id: string; box_info_id: string | null }>(
      'ft_fulfillment_outbounds', 'id, box_info_id', ids
    );

    // ── 2) 박스 + (목록에 없는) 마스터 박스 ──
    const BOX_SELECT = 'id, box_code, size, master_box_id';
    const boxMap = new Map<string, BoxRow>();
    for (const b of await selectByIds<BoxRow>('ft_box_info', BOX_SELECT, uniq(outbounds.map((o) => o.box_info_id)))) {
      boxMap.set(b.id, b);
    }
    const masterIds = uniq([...boxMap.values()].map((b) => b.master_box_id)).filter((id) => !boxMap.has(id));
    for (const b of await selectByIds<BoxRow>('ft_box_info', BOX_SELECT, masterIds)) boxMap.set(b.id, b);

    // ── 3) 포장 행마다 실제 상자 (합배송이면 마스터) ──
    const data: Record<string, { carton_code: string | null; carton_size: string | null }> = {};
    for (const o of outbounds) {
      const box = o.box_info_id ? boxMap.get(o.box_info_id) : undefined;
      if (!box) continue;
      const carton = (box.master_box_id && boxMap.get(box.master_box_id)) || box;
      data[o.id] = { carton_code: carton.box_code || null, carton_size: carton.size || null };
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('customs-document box-sizes 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '상자 사이즈 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
