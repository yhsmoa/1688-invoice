import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// GET /api/ft/box-info?user_id=X&status=PACKING
// 해당 유저의 박스 목록 조회
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const status = searchParams.get('status');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('ft_box_info')
      .select('id, user_code, box_code, type, no, size, weight, status, user_id, shipment_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    }

    // shipment_id가 NULL인 것만 (아직 출고되지 않은 박스)
    const shipmentFilter = searchParams.get('shipment_id');
    if (shipmentFilter === 'null') {
      query = query.is('shipment_id', null);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('ft_box_info GET 오류:', error);
    return NextResponse.json(
      { success: false, error: 'ft_box_info 조회 중 오류가 발생했습니다.', details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error) },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/ft/box-info
// 새 박스 생성
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_code, box_code, type, no, size, user_id } = body;

    if (!box_code || !user_id) {
      return NextResponse.json(
        { success: false, error: 'box_code와 user_id는 필수입니다.' },
        { status: 400 }
      );
    }

    // ── 중복 box_code 체크 (같은 user_id + shipment_id IS NULL) ──
    const { data: existing } = await supabase
      .from('ft_box_info')
      .select('id')
      .eq('box_code', box_code)
      .eq('user_id', user_id)
      .is('shipment_id', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: `이미 존재하는 박스코드입니다: ${box_code}` },
        { status: 409 }
      );
    }

    // ── INSERT ──
    const { data, error } = await supabase
      .from('ft_box_info')
      .insert({
        user_code: user_code || null,
        box_code,
        type: type || null,
        no: no || null,
        size: size || null,
        status: 'PACKING',
        user_id,
      })
      .select('id, box_code, type, no, size, status, user_code')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('ft_box_info POST 오류:', error);
    return NextResponse.json(
      { success: false, error: 'ft_box_info 생성 중 오류가 발생했습니다.', details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error) },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE /api/ft/box-info?id=xxx
// 박스 삭제 — 박스 안에 담긴 상품이 없을 때만 허용
//
// 거부 조건 (409):
//   1) 이미 쉽먼트에 배정된 박스 (shipment_id NOT NULL)
//   2) 박스에 담긴 출고 상품이 1건이라도 존재 (ft_fulfillment_outbounds)
//      → box_info_id 또는 (box_code + user_id) 양쪽으로 확인
//        (구 데이터는 box_info_id 가 NULL 일 수 있어 box_code 로 보조 확인)
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

    // ── 1) 박스 조회 ──
    const { data: box, error: boxErr } = await supabase
      .from('ft_box_info')
      .select('id, box_code, user_id, shipment_id')
      .eq('id', id)
      .maybeSingle();

    if (boxErr) throw boxErr;
    if (!box) {
      return NextResponse.json(
        { success: false, error: '해당 박스를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // ── 2) 이미 출고(쉽먼트 배정)된 박스는 삭제 불가 ──
    if (box.shipment_id) {
      return NextResponse.json(
        { success: false, reason: 'HAS_ITEMS', error: '이미 쉽먼트에 배정된 박스입니다. 담당자에게 문의해주세요.' },
        { status: 409 }
      );
    }

    // ── 3) 박스에 담긴 상품 확인 (box_info_id 기준) ──
    const { count: byIdCount, error: byIdErr } = await supabase
      .from('ft_fulfillment_outbounds')
      .select('id', { count: 'exact', head: true })
      .eq('box_info_id', id);

    if (byIdErr) throw byIdErr;

    // ── 3-b) 보조 확인: box_info_id 가 NULL 인 구 데이터 대비 ──
    //   box_code 는 출고 후 재사용되므로(예: MB-A-01), 다른 박스/과거 출고분을
    //   잘못 세지 않도록 box_info_id IS NULL + shipment_id IS NULL 인 행만 카운트.
    const { count: byCodeCount, error: byCodeErr } = await supabase
      .from('ft_fulfillment_outbounds')
      .select('id', { count: 'exact', head: true })
      .eq('box_code', box.box_code)
      .eq('user_id', box.user_id)
      .is('box_info_id', null)
      .is('shipment_id', null);

    if (byCodeErr) throw byCodeErr;

    const itemCount = Math.max(byIdCount ?? 0, byCodeCount ?? 0);

    if (itemCount > 0) {
      return NextResponse.json(
        {
          success: false,
          reason: 'HAS_ITEMS',
          itemCount,
          error: `박스에 상품 ${itemCount}건이 담겨 있어 삭제할 수 없습니다. 담당자에게 문의해주세요.`,
        },
        { status: 409 }
      );
    }

    // ── 4) 빈 박스 → 삭제 ──
    const { error: delErr } = await supabase
      .from('ft_box_info')
      .delete()
      .eq('id', id);

    if (delErr) throw delErr;

    return NextResponse.json({ success: true, box_code: box.box_code });
  } catch (error) {
    console.error('ft_box_info DELETE 오류:', error);
    return NextResponse.json(
      { success: false, error: '박스 삭제 중 오류가 발생했습니다.', details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error) },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/ft/box-info
// 박스 정보 수정 (status, size, weight 등)
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, fields } = body;

    if (!id || !fields || typeof fields !== 'object') {
      return NextResponse.json(
        { success: false, error: 'id와 fields가 필요합니다.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('ft_box_info')
      .update(fields)
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('ft_box_info PATCH 오류:', error);
    return NextResponse.json(
      { success: false, error: 'ft_box_info 수정 중 오류가 발생했습니다.', details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error) },
      { status: 500 }
    );
  }
}
