import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { FT_ORDER_ITEMS_DISPLAY_SELECT } from '../../../../../lib/ftOrderItemsSelect';

// ============================================================
// GET /api/ft/order-items/by-delivery-code?delivery_code=XXX
//
// 배송번호 2-hop 조회:
//   Step 1) 1688_invoice_deliveryInfo_check
//           WHERE delivery_code = input → order_id[]
//   Step 2) ft_order_items
//           WHERE 1688_order_id IN (order_ids) → FtOrderItem[]
//
// 정렬: item_no ASC (세트 구성품 연속 배치)
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

    // ── Step 1: deliveryInfo에서 order_id 목록 수집 (pagination) ──
    const PAGE = 1000;
    const allDeliveryRows: { order_id: string }[] = [];
    let from = 0;
    while (true) {
      const { data: batch, error: deliveryError } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('order_id')
        .eq('delivery_code', deliveryCode)
        .range(from, from + PAGE - 1);

      if (deliveryError) throw deliveryError;
      if (!batch || batch.length === 0) break;
      allDeliveryRows.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }

    // 중복 제거 + null 제외
    const orderIds = [
      ...new Set(
        allDeliveryRows
          .map((r) => r.order_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    if (orderIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // ── Step 2: ft_order_items에서 1688_order_id 기준 조회 (batch + pagination) ──
    //          SELECT는 /api/ft/order-items 와 완전 동일 → 화면 렌더 로직 일관성 보장
    const BATCH = 100;
    const allItems: Record<string, unknown>[] = [];

    for (let i = 0; i < orderIds.length; i += BATCH) {
      const idsBatch = orderIds.slice(i, i + BATCH);
      let oiFrom = 0;
      while (true) {
        const { data: oiBatch, error: oiError } = await supabase
          .from('ft_order_items')
          .select(FT_ORDER_ITEMS_DISPLAY_SELECT)
          .in('1688_order_id', idsBatch)
          .order('item_no', { ascending: true })
          .range(oiFrom, oiFrom + PAGE - 1);

        if (oiError) throw oiError;
        if (!oiBatch || oiBatch.length === 0) break;
        allItems.push(...(oiBatch as unknown as Record<string, unknown>[]));
        if (oiBatch.length < PAGE) break;
        oiFrom += PAGE;
      }
    }

    // ── Step 3: 배치 경계 너머 순서 보장 — 전체 결과 item_no 기준 최종 정렬 ──
    //   DB .order() 는 배치(100개 order_id)마다 적용되므로 배치간 순서 깨짐을 JS 로 정리.
    allItems.sort((a, b) => {
      const aNo = (a.item_no as string | null) ?? '';
      const bNo = (b.item_no as string | null) ?? '';
      if (!aNo && !bNo) return 0;
      if (!aNo) return 1;
      if (!bNo) return -1;
      return String(aNo).localeCompare(String(bNo), undefined, { numeric: true, sensitivity: 'base' });
    });

    return NextResponse.json({ success: true, data: allItems });

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
