import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError } from '../storageShared';

// ============================================================
// POST /api/ft/storage/move
//   위치 이동 — Body: { user_id, product_id, from_location_id, to_location_code, qty, operator_name }
//   → rpc ft_storage_move (MOVE_OUT / MOVE_IN 짝, 새 위치 자동 등록)
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const { user_id, product_id, from_location_id, to_location_code, qty, operator_name } = await request.json();

    if (!user_id || !product_id || !from_location_id) return fail('user_id, product_id, from_location_id 가 필요합니다.');
    if (typeof to_location_code !== 'string' || !to_location_code.trim()) return fail('옮길 위치를 입력해 주세요.');
    if (!Number.isInteger(qty) || qty < 1) return fail('수량을 1 이상으로 입력해 주세요.');
    if (!operator_name) return fail('담당자를 선택해 주세요.');

    const { data, error } = await supabase.rpc('ft_storage_move', {
      p_user_id: user_id,
      p_product_id: product_id,
      p_from_location_id: from_location_id,
      p_to_location_code: to_location_code,
      p_qty: qty,
      p_operator_name: operator_name,
    });
    if (error) {
      const e = toStorageError(error.message);
      if (e.code !== 'UNKNOWN') {
        return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true, ...(data as Record<string, unknown>) });
  } catch (error) {
    return serverError('위치 이동', error);
  }
}
