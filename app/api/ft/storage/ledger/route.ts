import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, fetchLocationCodes, fetchIn } from '../storageShared';
import type { LedgerRow, MovementKind } from '../../../../storage/types';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/ledger?user_id=&product_id=
//   상품 1개의 원장 타임라인 (PUTAWAY / PICK / UNPACK / MOVE)
//   PICK·UNPACK 은 연결된 포장 행의 박스코드를 같이 보여준다 (행이 철회됐으면 null)
// ============================================================

const PAGE = 1000;

interface MovementRow {
  id: string;
  created_at: string;
  kind: MovementKind;
  quantity: number;
  delta: number;
  location_id: string;
  operator_name: string | null;
  note: string | null;
  outbound_id: string | null;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const productId = request.nextUrl.searchParams.get('product_id');
  if (!userId || !productId) return fail('user_id, product_id 가 필요합니다.');

  try {
    const rows: MovementRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('ft_storage_movements')
        .select('id, created_at, kind, quantity, delta, location_id, operator_name, note, outbound_id')
        .eq('user_id', userId)
        .eq('product_id', productId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as MovementRow[]));
      if (!data || data.length < PAGE) break;
    }

    const [codes, outbounds] = await Promise.all([
      fetchLocationCodes(rows.map((r) => r.location_id)),
      fetchIn<{ id: string; box_code: string | null }>(
        'ft_fulfillment_outbounds',
        'id, box_code',
        'id',
        rows.map((r) => r.outbound_id ?? '').filter(Boolean)
      ),
    ]);
    const boxById = new Map(outbounds.map((o) => [o.id, o.box_code]));

    const data: LedgerRow[] = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      kind: r.kind,
      quantity: r.quantity,
      delta: r.delta,
      location_code: codes.get(r.location_id) ?? '?',
      operator_name: r.operator_name,
      note: r.note,
      outbound_box_code: r.outbound_id ? boxById.get(r.outbound_id) ?? null : null,
    }));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError('원장 조회', error);
  }
}
