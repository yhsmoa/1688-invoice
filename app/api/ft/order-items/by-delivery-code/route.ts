import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { pickDisplayColumns } from '../../../../../lib/ftOrderItemsSelect';
import { jsonResponse } from '../../../../../lib/apiResponse';

// ============================================================
// GET /api/ft/order-items/by-delivery-code?delivery_code=XXX
//
// 배송번호 조회 — RPC ft_order_items_by_delivery_code 1회 (supabase/perf/001)
//   deliveryInfo_check.delivery_code → order_id → ft_order_items."1688_order_id"
//   (두 단계를 DB 안에서 조인 — 전에는 PostgREST 두 번 순차 호출 + order_id 100개씩 배치)
//
// 정렬: item_no ASC (세트 구성품 연속 배치) — DB 정렬 뒤 숫자 인식 정렬로 한 번 더
//   [상품별로 보기] 정렬(product_id 그룹핑)은 클라이언트 측에서 처리.
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const deliveryCode = searchParams.get('delivery_code')?.trim();

    if (!deliveryCode) {
      return NextResponse.json(
        { success: false, error: 'delivery_code 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 컬럼은 /api/ft/order-items 와 완전 동일 → 화면 렌더 로직 일관성 보장 ──
    const { data, error } = await supabase.rpc('ft_order_items_by_delivery_code', {
      p_delivery_code: deliveryCode,
    });
    if (error) throw error;
    const allItems = pickDisplayColumns((data ?? []) as Record<string, unknown>[]);

    // ── 숫자 인식 정렬 — DB 의 문자열 정렬과 달리 "…-A2" 가 "…-A10" 앞에 오도록 ──
    allItems.sort((a, b) => {
      const aNo = (a.item_no as string | null) ?? '';
      const bNo = (b.item_no as string | null) ?? '';
      if (!aNo && !bNo) return 0;
      if (!aNo) return 1;
      if (!bNo) return -1;
      return String(aNo).localeCompare(String(bNo), undefined, { numeric: true, sensitivity: 'base' });
    });

    return jsonResponse(request, { success: true, data: allItems });

  } catch (error) {
    console.error('배송번호 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '배송번호로 아이템 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
