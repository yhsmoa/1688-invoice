import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { getOpenShipmentWork, toShipmentWorkError } from '../../../../lib/shipmentWork';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/shipment-work — 쉽먼트 작업 (supabase/shipment/004_shipment_work.sql)
//
//   GET ?user_id=  : 그 사업자의 열린 작업 { id, started_at, started_by } (없으면 data: null)
//                    쉽먼트 V2 (버튼 켜기) · 상품출고 V2 (담기 막힘 안내)가 같이 쓴다
//   POST { action, user_id, operator_name }
//     start  : [작업시작]  rpc ft_shipment_work_start — 이때부터 그 사업자의 박스에 담거나 뺄 수 없다
//     cancel : [작업취소]  rpc ft_shipment_work_end('CANCELLED') — 다시 담을 수 있다 (저장한 이동 · 합배송은 그대로)
//   [출고] 로 끝내는 것은 /api/ft/shipments 가 한다
//   오류 코드는 lib/shipmentWork.ts 문구로 409
// ============================================================

const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  if (!userId) return fail('user_id 파라미터가 필요합니다.');

  try {
    return NextResponse.json({ success: true, data: await getOpenShipmentWork(userId) });
  } catch (error) {
    console.error('쉽먼트 작업 조회 오류:', error);
    return fail('쉽먼트 작업 상태를 조회하지 못했습니다.', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, user_id, operator_name } = await request.json();

    if (!user_id || typeof user_id !== 'string') return fail('사용자를 선택해 주세요.');
    if (!operator_name || typeof operator_name !== 'string') return fail('처리 담당자를 선택해 주세요.');

    let rpc;
    if (action === 'start') {
      rpc = supabase.rpc('ft_shipment_work_start', { p_user_id: user_id, p_operator_name: operator_name });
    } else if (action === 'cancel') {
      rpc = supabase.rpc('ft_shipment_work_end', { p_user_id: user_id, p_kind: 'CANCELLED', p_operator_name: operator_name });
    } else {
      return fail('action 은 start · cancel 중 하나입니다.');
    }

    const { error } = await rpc;
    if (error) {
      const e = toShipmentWorkError(error.message);
      if (e) return NextResponse.json({ success: false, code: e.code, error: e.message }, { status: 409 });
      throw error;
    }
    // 끝난 뒤의 상태를 그대로 돌려준다 (start → 열린 작업, cancel → null)
    return NextResponse.json({ success: true, data: await getOpenShipmentWork(user_id) });
  } catch (error) {
    console.error('쉽먼트 작업 처리 오류:', error);
    return fail('쉽먼트 작업 처리 중 오류가 발생했습니다.', 500);
  }
}
