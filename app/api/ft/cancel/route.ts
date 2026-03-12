import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// 취소 접수 아이템 타입
// ============================================================
interface CancelItem {
  order_item_id: string;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  order_no: string | null;
  product_no: string | null;
  product_id: string | null;
  order_1688_id: string | null;  // ft_order_items.'1688_order_id'
  qty: number;
  total_price_cny: number | null;
  delivery_price_cny: number | null;
  service_fee: number | null;
  cancel_reason: string | null;
  requester: string | null;      // '유화무역' | '고객'
}

// ============================================================
// POST /api/ft/cancel
// 반품 접수 처리:
//   1) ft_fulfillments INSERT (type='CANCEL') per item → id 반환
//   2) ft_cancel_details INSERT per item (fulfillments.id 연결) → id 반환
//   3) 저장 검증:
//      - ft_fulfillments: 반환된 id로 SELECT
//      - ft_cancel_details: 반환된 id로 SELECT (PK 기준)
//
// 주의: ft_cancel_details 검증 시 'fulfillments.id' 컬럼 필터 사용 금지
//       PostgREST에서 점(.)을 외래키 join traversal로 해석하여 count=0 반환
//       → INSERT 반환값(cd.id)으로 PK 검증으로 대체
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, operator_name, items } = body as {
      user_id: string;
      operator_name: string;
      items: CancelItem[];
    };

    // ── 유효성 검사
    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '취소 접수할 항목이 없습니다.' },
        { status: 400 }
      );
    }
    if (items.some((item) => !item.qty || item.qty <= 0)) {
      return NextResponse.json(
        { success: false, error: '수량은 1 이상이어야 합니다.' },
        { status: 400 }
      );
    }

    const insertedFulfillmentIds: string[] = [];
    const insertedCancelDetailIds: string[] = [];

    // ── 아이템별 순차 처리
    for (const item of items) {

      // ── Step 1: ft_fulfillments INSERT (type='CANCEL')
      // ft_fulfillments (inbound) — CANCEL 타입
      const { data: ffData, error: ffError } = await supabase
        .from('ft_fulfillment_inbounds')
        .insert({
          order_item_id: item.order_item_id,
          type: 'CANCEL',
          quantity: item.qty,
          operator_name: operator_name || null,
          order_no: item.order_no || null,
          item_no: item.item_no || null,
          product_no: item.product_no || null,
          product_id: item.product_id || null,
          user_id: user_id,
          note: null,
        })
        .select('id')
        .single();

      if (ffError) {
        console.error('ft_fulfillments CANCEL insert 오류:', ffError);
        throw ffError;
      }

      const fulfillmentId = ffData?.id ?? null;
      if (fulfillmentId) insertedFulfillmentIds.push(fulfillmentId);

      // ── Step 2: ft_cancel_details INSERT → id 반환받아 검증에 사용
      // 'fulfillments.id' 컬럼명에 점(.)이 포함되어 있어
      // 이후 필터 조건으로 사용 불가 (PostgREST join traversal 오인식)
      // → insert 반환값(id)을 수집해 PK 기준으로 검증
      const { data: cdData, error: cdError } = await supabase
        .from('ft_cancel_details')
        .insert({
          status: 'PENDING',
          order_items_id: item.order_item_id,
          item_no: item.item_no || null,
          item_name: item.item_name || null,
          option_name: item.option_name || null,
          qty: item.qty,
          total_price_cny: item.total_price_cny ?? null,
          delivery_price_cny: item.delivery_price_cny ?? null,
          service_fee: item.service_fee ?? null,
          cancel_reason: item.cancel_reason || null,
          user_id: user_id,
          '1688_order_no': item.order_1688_id || null,
          requester: item.requester || null,
          'fulfillments.id': fulfillmentId,
        })
        .select('id')
        .single();

      if (cdError) {
        console.error('ft_cancel_details insert 오류:', cdError);
        throw cdError;
      }

      const cancelDetailId = cdData?.id ?? null;
      if (cancelDetailId) insertedCancelDetailIds.push(cancelDetailId);
    }

    // ── Step 3: 저장 검증 — INSERT 반환 id 기준으로 SELECT 확인
    // ft_fulfillments: id(PK) 기준
    // ft_cancel_details: id(PK) 기준 (fulfillments.id 필터 사용 안 함)
    const [ffVerify, cdVerify] = await Promise.all([
      supabase
        .from('ft_fulfillment_inbounds')
        .select('id', { count: 'exact', head: true })
        .in('id', insertedFulfillmentIds),
      supabase
        .from('ft_cancel_details')
        .select('id', { count: 'exact', head: true })
        .in('id', insertedCancelDetailIds),
    ]);

    const ffCount = ffVerify.count ?? 0;
    const cdCount = cdVerify.count ?? 0;
    const expected = insertedFulfillmentIds.length;

    if (ffCount !== expected || cdCount !== expected) {
      console.error(
        `검증 실패 — 기대: ${expected}건, ft_fulfillments: ${ffCount}건, ft_cancel_details: ${cdCount}건`
      );
      return NextResponse.json(
        {
          success: false,
          error: `저장 검증 실패 (ft_fulfillments: ${ffCount}/${expected}, ft_cancel_details: ${cdCount}/${expected})`,
        },
        { status: 500 }
      );
    }

    console.log(
      `반품 접수 완료 및 검증 통과 — fulfillments: ${ffCount}건, cancel_details: ${cdCount}건`
    );

    return NextResponse.json({
      success: true,
      message: `반품 접수 완료 (${cdCount}건)`,
      count: cdCount,
      verified: { fulfillments: ffCount, cancelDetails: cdCount },
    });

  } catch (error) {
    console.error('취소 접수 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '취소 접수 처리 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ??
          JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
