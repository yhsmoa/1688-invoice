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
