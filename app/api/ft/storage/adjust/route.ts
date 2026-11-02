import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError } from '../storageShared';

// ============================================================
// POST /api/ft/storage/adjust
//   재고 수량 수정 — Body: { user_id, product_id, location_id, new_qty, note, operator_name }
//   → rpc ft_storage_adjust (현재 잔량과의 차이를 ADJUST 원장으로 기록, 사유 필수)
//   Response: { success, before, after, delta }
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const { user_id, product_id, location_id, new_qty, note, operator_name } = await request.json();

    if (!user_id || !product_id || !location_id) return fail('user_id, product_id, location_id 가 필요합니다.');
    if (!Number.isInteger(new_qty) || new_qty < 0) return fail('수량을 0 이상으로 입력해 주세요.');
    if (typeof note !== 'string' || !note.trim()) return fail('사유를 입력해 주세요.');
    if (!operator_name) return fail('담당자를 선택해 주세요.');

    const { data, error } = await supabase.rpc('ft_storage_adjust', {
      p_user_id: user_id,
      p_product_id: product_id,
      p_location_id: location_id,
      p_new_qty: new_qty,
      p_note: note.trim(),
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
    return serverError('재고 수량 수정', error);
  }
}
