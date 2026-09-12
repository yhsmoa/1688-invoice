import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { confirmDoneForUser } from '../../../../lib/confirmDone';

// ============================================================
// 허용된 업데이트 필드 (화이트리스트)
// dot(.) 포함 컬럼(fulfillments.id, 1688_order_no)은 제외
//
// done_at 은 여기 없다 — 클라이언트가 직접 못 정하고, status 변경에 맞춰
// 서버가 자동으로 채우거나 비운다 (아래 PATCH 참고).
// ============================================================
const ALLOWED_UPDATE_FIELDS = new Set([
  'status',
  'requester',
  'total_price_cny',
  'delivery_price_cny',
  'service_fee',
  'cancel_reason',
]);

// 유효한 status 값
const VALID_STATUSES = new Set(['PENDING', 'PROCESSING', 'DONE']);

// ============================================================
// PATCH /api/ft/cancel-details
// 단일 필드 업데이트 (상태 변경 / 요청자 변경 / 금액 수정 / 사유 수정)
//
// Body: { id: string, field: string, value: string | number | null }
//
// status 변경 시 done_at 도 같이 쓴다 (완료 시점 기록):
//   · 'DONE'      → done_at = 지금
//   · 그 외 상태   → done_at = NULL  (되돌리면 이전 완료 시각이 남아 있으면 안 된다)
// 반품 화면의 [완료] 버튼도 이 경로를 타므로 여기 한 곳만 처리하면 된다
// (상태 드롭다운으로 직접 DONE 으로 바꾸는 경우까지 같이 커버된다).
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, field, value } = body as {
      id: string;
      field: string;
      value: string | number | null;
    };

    // ── 유효성 검사
    if (!id) {
      return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 });
    }
    if (!field || !ALLOWED_UPDATE_FIELDS.has(field)) {
      return NextResponse.json(
        { success: false, error: `허용되지 않은 필드입니다: ${field}` },
        { status: 400 }
      );
    }
    if (field === 'status' && value !== null && !VALID_STATUSES.has(value as string)) {
      return NextResponse.json(
        { success: false, error: `유효하지 않은 status 값: ${value}` },
        { status: 400 }
      );
    }

    // ── 업데이트 (status 면 완료 시점 done_at 동시 기록)
    const patch: Record<string, string | number | null> = { [field]: value };
    if (field === 'status') {
      patch.done_at = value === 'DONE' ? new Date().toISOString() : null;
    }

    const { error: updateErr } = await supabase
      .from('ft_cancel_details')
      .update(patch)
      .eq('id', id);

    if (updateErr) {
      console.error('ft_cancel_details PATCH 오류:', updateErr);
      throw updateErr;
    }

    // ── status='DONE' 시 ft_order_items 남은수량 재계산 ──
    let doneCount = 0;
    if (field === 'status' && value === 'DONE') {
      try {
        const { data: detail, error: fetchErr } = await supabase
          .from('ft_cancel_details')
          .select('user_id')
          .eq('id', id)
          .single();

        if (fetchErr) throw fetchErr;

        if (detail?.user_id) {
          const { updated } = await confirmDoneForUser(detail.user_id);
          doneCount = updated;
          console.log(`cancel-details 완료 처리 후 ft_order_items DONE 전환: ${doneCount}건`);
        }
      } catch (confirmErr) {
        console.error('confirmDoneForUser 실행 오류:', confirmErr);
        // 주 업데이트는 완료되었으므로 오류 발생해도 응답 반환
      }
    }

    return NextResponse.json({
      success: true,
      id,
      field,
      value,
      ...(field === 'status' ? { done_at: patch.done_at } : {}),
      doneCount,
    });

  } catch (error) {
    console.error('ft_cancel_details PATCH 처리 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_cancel_details 업데이트 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/ft/cancel-details?user_id=xxx
// ft_cancel_details를 user_id로 전체 조회 (created_at DESC)
//
// 주의:
//   - Supabase 기본 1000행 limit 우회 → while(true) 페이징
//   - SELECT * 사용: "fulfillments.id" 컬럼은 PostgREST가 FK join으로
//     오인식하므로 개별 select 불가 → * 로 전체 조회 후 JS에서 매핑
//   - 응답에 fulfillments_id 필드 추가 (철회 기능용)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('user_id');

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 전체 데이터 페이징 조회 (1000행 limit 우회) ──────────
    const PAGE = 1000;
    const allRaw: Record<string, unknown>[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('ft_cancel_details')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allRaw.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // ── "fulfillments.id" dot 컬럼 → fulfillments_id 로 매핑 ──
    //   cancel_type 도 응답 포함 — 'CANCEL'(주문취소) | 'RETURN'(반품접수) 구분용.
    //   NULL 가능성 (마이그레이션 직후) → DEFAULT 'CANCEL' 로 fallback.
    const allData = allRaw.map((row) => ({
      id: row.id,
      status: row.status,
      order_items_id: row.order_items_id,
      item_no: row.item_no,
      item_name: row.item_name,
      option_name: row.option_name,
      qty: row.qty,
      total_price_cny: row.total_price_cny,
      delivery_price_cny: row.delivery_price_cny,
      service_fee: row.service_fee,
      cancel_reason: row.cancel_reason,
      created_at: row.created_at,
      // 완료(DONE) 시점. 컬럼 추가 이전에 완료된 행은 NULL 이다
      done_at: row.done_at ?? null,
      user_id: row.user_id,
      '1688_order_no': row['1688_order_no'],
      requester: row.requester,
      fulfillments_id: row['fulfillments.id'] ?? null,
      cancel_type: (row.cancel_type as string | null) ?? 'CANCEL',
    }));

    return NextResponse.json({ success: true, data: allData });

  } catch (error) {
    console.error('ft_cancel_details GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_cancel_details 조회 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ??
          JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
