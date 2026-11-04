import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { requireDbAccess } from '../../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/new-orders/reject   { cart_id }
//   신규주문 상황 [반려] — auto-1688-order 프로그램 [V2 주문] 탭 [반려] 와 같은 동작
//
//   ft_carts.status 'ORDER' → 'NEW' (고객 장바구니로 되돌림, 카트·품목은 그대로)
//
//   권한: 요청 헤더 x-db-access-code 의 직원 코드 — 직책 '기업' · '매니저' (scope 'cartReject')
//
//   조건부 UPDATE (status = 'ORDER' 인 행만):
//     프로그램이 이미 불러가 저장했으면 status = 'DONE' → 0행 → 409
//     (DONE 카트를 NEW 로 되살려 중복 주문이 생기는 것을 막는다)
// ============================================================
export async function POST(request: NextRequest) {
  const access = await requireDbAccess(request, 'cartReject');
  if (!access.ok) return access.response;

  try {
    const body = await request.json();
    const cartId = typeof body?.cart_id === 'string' ? body.cart_id : '';
    if (!cartId) {
      return NextResponse.json({ success: false, error: '반려할 카트 id 가 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('ft_carts')
      .update({ status: 'NEW' })
      .eq('id', cartId)
      .eq('status', 'ORDER')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(
        { success: false, error: '이미 주문 처리됐거나 반려된 카트입니다. 새로고침 후 확인해주세요.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('신규주문 반려 오류:', error);
    return NextResponse.json({ success: false, error: '반려 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
