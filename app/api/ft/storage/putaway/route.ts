import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError } from '../storageShared';

// ============================================================
// POST /api/ft/storage/putaway
//   Body: { user_id, product_id, inbound_id, location_code, qty, operator_name }
//   → rpc ft_storage_putaway (위치 자동 등록 · 상품 단위 미배치 검증 · 상품별 직렬화)
//   Response: { success, location_id, location_code, remaining }
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const { user_id, product_id, inbound_id, location_code, qty, operator_name } = await request.json();

    if (!user_id || !product_id || !inbound_id) return fail('user_id, product_id, inbound_id 가 필요합니다.');
    if (typeof location_code !== 'string' || !location_code.trim()) return fail('위치를 입력해 주세요.');
    if (!Number.isInteger(qty) || qty < 1) return fail('수량을 1 이상으로 입력해 주세요.');
    if (!operator_name) return fail('담당자를 선택해 주세요.');

    const { data, error } = await supabase.rpc('ft_storage_putaway', {
      p_user_id: user_id,
      p_product_id: product_id,
      p_inbound_id: inbound_id,
      p_location_code: location_code,
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
    return serverError('위치 배치', error);
  }
}
