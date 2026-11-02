import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { fail, serverError, toStorageError } from '../storageShared';
import type { PickInput } from '../../../../storage/types';

// ============================================================
// POST /api/ft/storage/pick
//   재고 → 쉽먼트: 위치에서 꺼내(PICK) 박스에 담는다(PACKED) — 한 트랜잭션
//   Body: { user_id, product_id, order_item_id, picks: [{ location_id, qty }], box_info_id,
//           operator_name, force?: boolean,
//           shipment_type?, coupang_shipment_size?, personal_order_no? }
//     · force = 박스 타입 불일치 허용 (상품출고 V2 의 "A=B=C=P=X" 와 같은 의미)
//     · 타입 3개 = S 상품은 꺼낼 때 타입을 정한다 (supabase/storage/003_stock_type.sql).
//       비우면 DB 가 미처리 고객 요청 → 상품의 기존 타입 순으로 쓴다
//   Response: { success, outbound_id, box_code, picked, shipment_type, coupang_shipment_size, personal_order_no }
//     실패 시 code 로 박스 타입 불일치(PICK_BOX_TYPE_MISMATCH)를 구분 → 화면이 허용 체크 안내
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const {
      user_id, product_id, order_item_id, picks, box_info_id, operator_name, force,
      shipment_type, coupang_shipment_size, personal_order_no,
    } = await request.json();

    if (!user_id || !product_id || !order_item_id) return fail('user_id, product_id, order_item_id 가 필요합니다.');
    if (!box_info_id) return fail('박스를 선택해 주세요.');
    if (!operator_name) return fail('담당자를 선택해 주세요.');
    const list = (Array.isArray(picks) ? picks : []) as PickInput[];
    if (list.length === 0 || list.some((p) => !p?.location_id || !Number.isInteger(p.qty) || p.qty < 1)) {
      return fail('위치별 수량을 1 이상으로 입력해 주세요.');
    }

    const { data, error } = await supabase.rpc('ft_storage_pick_to_shipment', {
      p_user_id: user_id,
      p_product_id: product_id,
      p_order_item_id: order_item_id,
      p_picks: list.map((p) => ({ location_id: p.location_id, qty: p.qty })),
      p_box_info_id: box_info_id,
      p_operator_name: operator_name,
      p_force: force === true,
      p_shipment_type: shipment_type || null,
      p_size: coupang_shipment_size || null,
      p_personal_order_no: personal_order_no || null,
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
    return serverError('재고 쉽먼트', error);
  }
}
