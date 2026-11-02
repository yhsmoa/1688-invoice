import { NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { serverError } from '../storageShared';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/locations
//   위치 목록 (창고 공용) + 지금 들어 있는 수량 합 (전체 사업자)
//   1차는 조회만 — 이름·구역·비활성 편집은 후속 (docs/PLAN_stock-type-S.md §7)
// ============================================================

const PAGE = 1000;

interface LocationRow { id: string; code: string; name: string | null; zone: string | null; active: boolean }
interface UsedRow { location_id: string; qty: number }

export async function GET() {
  try {
    const locations: LocationRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_storage_locations')
        .select('id, code, name, zone, active')
        .order('code', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      locations.push(...((data ?? []) as LocationRow[]));
      if (!data || data.length < PAGE) break;
    }

    const used = new Map<string, number>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_storage_balance')
        .select('location_id, qty')
        .order('location_id', { ascending: true })
        .order('product_id', { ascending: true })
        .order('user_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of (data ?? []) as UsedRow[]) used.set(r.location_id, (used.get(r.location_id) ?? 0) + r.qty);
      if (!data || data.length < PAGE) break;
    }

    return NextResponse.json({
      success: true,
      data: locations.map((l) => ({ ...l, qty: used.get(l.id) ?? 0 })),
    });
  } catch (error) {
    return serverError('위치 목록 조회', error);
  }
}
