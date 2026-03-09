import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// 공통 상수
// ============================================================
const FULFILLMENT_TYPES = ['ARRIVAL', 'PACKED', 'CANCEL', 'SHIPMENT'];

// ============================================================
// DELETE /api/ft/fulfillments?id=xxx
// ft_fulfillments 단건 삭제 + 연동 처리
//
// type=CANCEL인 경우:
//   1) ft_cancel_details 연동 삭제 (fulfillments.id 컬럼으로 연결)
//   2) ft_order_items status 재계산
//      → 남은수량 > 0 이고 status='DONE' → 'PROCESSING' 복구
//   3) 삭제 검증 (SELECT로 실제 제거 확인)
//
// type=기타(ARRIVAL/PACKED/SHIPMENT):
//   ft_fulfillments만 단순 삭제
// ============================================================
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── Step 1: 삭제 전 fulfillment 데이터 조회 ──────────────
    // order_item_id, type 을 보관해 후속 처리에 사용
    const { data: ffRow, error: selectErr } = await supabase
      .from('ft_fulfillments')
      .select('id, order_item_id, type, quantity')
      .eq('id', id)
      .single();

    if (selectErr || !ffRow) {
      return NextResponse.json(
        { success: false, error: '해당 기록을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const { order_item_id, type: ffType } = ffRow;

    // ── Step 2: ft_cancel_details 연동 삭제 (CANCEL 타입만) ──
    // 주의: 'fulfillments.id' 컬럼은 PostgREST에서 dot(.)을 외래키 join으로 오인식
    //       → .eq('fulfillments.id', id) 는 항상 0행 반환 (사용 불가)
    //       → 해결책: SELECT * 로 조회 후 JS에서 r['fulfillments.id'] === id 필터링
    //         (SELECT * 는 모든 컬럼을 실제 이름 그대로 반환하므로 dot 컬럼도 정상 포함)
    let cancelDetailDeletedCount = 0;

    if (ffType === 'CANCEL') {
      // order_items_id로 후보 행 조회 → JS에서 fulfillments.id 매칭
      const { data: cdAllRows, error: cdSelectErr } = await supabase
        .from('ft_cancel_details')
        .select('*')
        .eq('order_items_id', order_item_id);

      if (cdSelectErr) {
        console.warn('ft_cancel_details 조회 경고:', cdSelectErr);
      }

      // JS 필터: 'fulfillments.id' 컬럼 값이 삭제 대상 fulfillment id와 일치하는 행
      const cdRows = (cdAllRows ?? []).filter(
        (r: Record<string, unknown>) => r['fulfillments.id'] === id
      );

      if (cdRows.length > 0) {
        const cdIds = cdRows.map((r: Record<string, unknown>) => r.id as string);

        const { error: cdDeleteErr } = await supabase
          .from('ft_cancel_details')
          .delete()
          .in('id', cdIds);

        if (cdDeleteErr) {
          console.error('ft_cancel_details 삭제 오류:', cdDeleteErr);
          throw cdDeleteErr;
        }

        cancelDetailDeletedCount = cdIds.length;
        console.log(`ft_cancel_details 삭제: ${cancelDetailDeletedCount}건`);
      }
    }

    // ── Step 3: ft_fulfillments 삭제 ─────────────────────────
    const { error: ffDeleteErr } = await supabase
      .from('ft_fulfillments')
      .delete()
      .eq('id', id);

    if (ffDeleteErr) {
      console.error('ft_fulfillments 삭제 오류:', ffDeleteErr);
      throw ffDeleteErr;
    }

    // ── Step 4: ft_order_items status 재계산 (CANCEL 타입만) ──
    // 시나리오: CANCEL 철회 시 DONE이었던 항목이 PROCESSING으로 복구될 수 있음
    let statusRestored = false;

    if (ffType === 'CANCEL') {
      // 현재 order_item 상태 조회
      const { data: orderItem } = await supabase
        .from('ft_order_items')
        .select('id, order_qty, status')
        .eq('id', order_item_id)
        .single();

      if (orderItem && orderItem.status === 'DONE') {
        // 삭제 후 남은 CANCEL + 출고완료(PACKED with shipment_id) 합계 재계산
        const { data: remainingFF } = await supabase
          .from('ft_fulfillments')
          .select('quantity, type, shipment_id')
          .eq('order_item_id', order_item_id)
          .in('type', ['CANCEL', 'PACKED']);

        let cancelSum = 0;
        let shippedSum = 0;

        for (const row of (remainingFF ?? [])) {
          if (row.type === 'CANCEL') {
            cancelSum += row.quantity ?? 0;
          } else if (row.type === 'PACKED' && row.shipment_id != null) {
            shippedSum += row.quantity ?? 0;
          }
        }

        // 남은수량 = order_qty - CANCEL합계 - 출고완료PACKED합계
        const remaining = (orderItem.order_qty ?? 0) - cancelSum - shippedSum;

        if (remaining > 0) {
          const { error: restoreErr } = await supabase
            .from('ft_order_items')
            .update({ status: 'PROCESSING' })
            .eq('id', order_item_id);

          if (restoreErr) {
            console.error('ft_order_items status 복구 오류:', restoreErr);
            // status 복구 실패는 치명적이지 않으므로 로그만 남김
          } else {
            statusRestored = true;
            console.log(`ft_order_items DONE→PROCESSING 복구 — id: ${order_item_id}, 남은수량: ${remaining}`);
          }
        }
      }
    }

    // ── Step 5: 삭제 검증 — SELECT로 실제 제거 확인 ──────────
    const { data: verifyFF } = await supabase
      .from('ft_fulfillments')
      .select('id')
      .eq('id', id);

    const ffDeleted = !verifyFF || verifyFF.length === 0;

    // CANCEL 타입: ft_cancel_details도 검증
    // 동일하게 JS 필터 방식 사용 (dot 컬럼 filter 불가 회피)
    let cdDeleted = true;
    if (ffType === 'CANCEL') {
      const { data: verifyCD } = await supabase
        .from('ft_cancel_details')
        .select('*')
        .eq('order_items_id', order_item_id);

      const remaining = (verifyCD ?? []).filter(
        (r: Record<string, unknown>) => r['fulfillments.id'] === id
      );
      cdDeleted = remaining.length === 0;
    }

    if (!ffDeleted || !cdDeleted) {
      console.error(
        `삭제 검증 실패 — ft_fulfillments: ${ffDeleted ? '삭제됨' : '남아있음'}, ` +
        `ft_cancel_details: ${cdDeleted ? '삭제됨' : '남아있음'}`
      );
      return NextResponse.json(
        {
          success: false,
          error: '삭제 검증 실패: 일부 데이터가 남아있습니다.',
          verified: { fulfillment: ffDeleted, cancel_details: cdDeleted },
        },
        { status: 500 }
      );
    }

    console.log(
      `삭제 완료 및 검증 통과 — id: ${id}, type: ${ffType}, ` +
      `cancel_details: ${cancelDetailDeletedCount}건, status 복구: ${statusRestored}`
    );

    return NextResponse.json({
      success: true,
      deleted: {
        fulfillment_id: id,
        type: ffType,
        cancel_details_count: cancelDetailDeletedCount,
      },
      status_restored: statusRestored,
    });

  } catch (error) {
    console.error('ft_fulfillments DELETE 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 삭제 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ??
          JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/ft/fulfillments?order_item_ids=id1,id2,...
// (소량 조회 시 사용 가능, 다량은 POST 사용 권장)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('order_item_ids') ?? '';
    const orderItemIds = raw.split(',').map((s) => s.trim()).filter(Boolean);

    if (orderItemIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data, error } = await supabase
      .from('ft_fulfillments')
      .select('order_item_id, quantity, type')
      .in('order_item_id', orderItemIds)
      .in('type', FULFILLMENT_TYPES);

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('ft_fulfillments GET 조회 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 조회 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ??
          JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/ft/fulfillments
// [1] { order_item_ids: string[] }  → 집계 조회 (GET 대체, URI 길이 제한 회피)
//     100개 단위 배치 처리 + Supabase 1000행 limit 우회
// [2] { items: FulfillmentItem[] }  → 입고 데이터 일괄 저장
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items, order_item_ids } = body;

    // ── [1] 조회 모드 ──────────────────────────────────────────
    // Supabase .in()도 내부적으로 URL 쿼리 파라미터 → ID 수가 많으면 실패
    // 100개 단위로 배치 조회 후 합산
    if (order_item_ids && Array.isArray(order_item_ids)) {
      try {
        if (order_item_ids.length === 0) {
          return NextResponse.json({ success: true, data: [] });
        }

        const BATCH_SIZE = 100;
        const allData: {
          id: string;
          order_item_id: string;
          quantity: number;
          type: string;
          created_at: string;
          operator_name: string | null;
        }[] = [];

        for (let i = 0; i < order_item_ids.length; i += BATCH_SIZE) {
          const batch = order_item_ids.slice(i, i + BATCH_SIZE);

          // 각 배치도 1000행 limit 우회 (페이징)
          let from = 0;
          const PAGE = 1000;

          while (true) {
            const { data, error } = await supabase
              .from('ft_fulfillments')
              .select('id, order_item_id, quantity, type, created_at, operator_name')
              .in('order_item_id', batch)
              .in('type', FULFILLMENT_TYPES)
              .range(from, from + PAGE - 1);

            if (error) throw error;
            if (!data || data.length === 0) break;
            allData.push(...data);
            if (data.length < PAGE) break;
            from += PAGE;
          }
        }

        return NextResponse.json({ success: true, data: allData });
      } catch (queryError) {
        console.error('ft_fulfillments POST 조회 오류:', queryError);
        return NextResponse.json(
          {
            success: false,
            error: 'ft_fulfillments 조회 중 오류가 발생했습니다.',
            details:
              (queryError as Record<string, unknown>)?.message ??
              JSON.stringify(queryError),
          },
          { status: 500 }
        );
      }
    }

    // ── [2] 저장 모드 ──────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: '저장할 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // order_no 정규화: BZ-260224-0202-A01 → BZ-260224-0202
    const normalizeOrderNo = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const parts = value.split('-');
      return parts.length > 3 ? parts.slice(0, 3).join('-') : value;
    };

    const normalizedItems: Record<string, unknown>[] = (
      items as Record<string, unknown>[]
    ).map((item) => ({
      ...item,
      order_no: normalizeOrderNo(item.order_no as string | null),
    }));

    // 조회 시 SUM 집계하므로 행이 여러 개여도 정상 동작
    const insertRows = normalizedItems.map((item) => ({
      order_item_id: item.order_item_id as string,
      box_code:
        (item.box_code as string) || (item.package_no as string) || null,
      type: (item.type as string) || 'PACKED',
      quantity: item.quantity as number,
      user_id: (item.user_id as string) || null,
      order_no: (item.order_no as string) || null,
      item_no: (item.item_no as string) || null,
      product_no: (item.product_no as string) || null,
      operator_name: (item.operator_name as string) || null,
      shipment: (item.shipment as boolean) ?? false,
      box_info_id: (item.box_info_id as string) || null,
      product_id: (item.product_id as string) || null,
    }));

    const { error: insertErr } = await supabase
      .from('ft_fulfillments')
      .insert(insertRows);

    if (insertErr) {
      console.error('ft_fulfillments insert 오류:', insertErr);
      throw insertErr;
    }

    console.log(`ft_fulfillments 저장 완료: ${insertRows.length}개 insert`);

    return NextResponse.json({
      success: true,
      count: insertRows.length,
      message: `저장 완료 (${insertRows.length}개)`,
    });
  } catch (error) {
    console.error('ft_fulfillments 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_fulfillments 저장 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ??
          JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
