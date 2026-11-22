import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { fetchIn } from '../storage/storageShared';
import { wowShippable } from '../../../storage/utils/wowStage';

// ============================================================
// GET /api/ft/shipments?user_id=X
//   → 해당 유저의 전체 쉽먼트 목록 (id, shipment_no, date)
//   → 클라이언트에서 년/월/shipment_no 드롭다운 구성에 사용
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'user_id 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('ft_shipments')
      .select('id, shipment_no, date')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('ft_shipments GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'ft_shipments 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/ft/shipments
// 출고 처리: ft_shipments 생성 → ft_box_info.shipment_id 업데이트
//          → ft_fulfillments.shipment_no + shipment_id + shipment=true 업데이트
//          → 출고된 포장 행의 미처리 이동요청(ft_move_requests) CANCELLED(note='shipped')
//   와우출고 박스(supabase/storage/005_wow.sql)는 [서류준비] 단계부터, 박스 통째로만, 일반 박스와 다른 출고번호로 (409)
//
// Body: {
//   user_id: string,
//   shipment_no: string,        // 'SH' + user_code + 6자리숫자
//   date: string,               // yyyy-mm-dd
//   fulfillment_ids: string[],  // 체크된 ft_fulfillments.id 목록
//   box_codes: string[],        // 체크된 행의 고유 box_code 목록
// }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, shipment_no, date, fulfillment_ids, box_codes } = body;

    if (!user_id || !shipment_no) {
      return NextResponse.json(
        { success: false, error: 'user_id와 shipment_no는 필수입니다.' },
        { status: 400 }
      );
    }

    if (!fulfillment_ids || !Array.isArray(fulfillment_ids) || fulfillment_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: '출고할 항목이 없습니다.' },
        { status: 400 }
      );
    }

    const wowError = await checkWowSelection(fulfillment_ids);
    if (wowError) {
      return NextResponse.json({ success: false, error: wowError }, { status: 409 });
    }

    // ── 1단계: ft_shipments에 레코드 생성 ──
    const { data: shipmentData, error: shipmentErr } = await supabase
      .from('ft_shipments')
      .insert({
        user_id,
        shipment_no,
        date: date || new Date().toISOString().slice(0, 10),
      })
      .select('id, shipment_no')
      .single();

    if (shipmentErr) {
      console.error('ft_shipments INSERT 오류:', shipmentErr);
      throw shipmentErr;
    }

    const shipmentId = shipmentData.id;
    console.log(`ft_shipments 생성 완료: ${shipmentId} (${shipment_no})`);

    // ── 2단계: ft_box_info.shipment_id 업데이트 (box_code 기준) ──
    //   box_code 는 출고 후 재사용된다 → 이 사용자의 미출고 박스만 (같은 코드의 옛 박스를 덮어쓰지 않게)
    if (box_codes && Array.isArray(box_codes) && box_codes.length > 0) {
      const { error: boxErr } = await supabase
        .from('ft_box_info')
        .update({ shipment_id: shipmentId })
        .eq('user_id', user_id)
        .is('shipment_id', null)
        .in('box_code', box_codes);

      if (boxErr) {
        console.error('ft_box_info shipment_id 업데이트 오류:', boxErr);
        // 롤백하지 않고 경고만 — 핵심은 fulfillments 업데이트
      } else {
        console.log(`ft_box_info shipment_id 업데이트: ${box_codes.length}개 박스`);
      }
    }

    // ── 3단계: ft_fulfillment_outbounds 업데이트 (shipment_no + shipment_id) ──
    //    100개씩 배치 처리 (Supabase .in() 제한 대응)
    const BATCH = 100;
    let updateCount = 0;

    for (let i = 0; i < fulfillment_ids.length; i += BATCH) {
      const batch = fulfillment_ids.slice(i, i + BATCH);
      const { error: ffErr } = await supabase
        .from('ft_fulfillment_outbounds')
        .update({
          shipment_no,
          shipment_id: shipmentId,
        })
        .in('id', batch);

      if (ffErr) {
        console.error('ft_fulfillment_outbounds 출고 업데이트 오류:', ffErr);
        throw ffErr;
      }
      updateCount += batch.length;
    }

    console.log(`ft_fulfillment_outbounds 출고 업데이트 완료: ${updateCount}건`);

    // ── 4단계: 출고된 행의 미처리 이동요청 닫기 ──
    //   출고 후엔 박스를 옮길 수 없으므로 요청이 열린 채 남으면 고객 화면 집계가 틀어진다.
    //   출고 자체는 이미 끝났으므로 실패해도 롤백하지 않고 로그만 남긴다.
    for (let i = 0; i < fulfillment_ids.length; i += BATCH) {
      const batch = fulfillment_ids.slice(i, i + BATCH);
      const { error: reqErr } = await supabase
        .from('ft_move_requests')
        .update({ status: 'CANCELLED', note: 'shipped', done_at: new Date().toISOString() })
        .in('outbound_id', batch)
        .eq('status', 'REQUESTED');
      if (reqErr) console.error('ft_move_requests 출고 정리 오류:', reqErr);
    }

    return NextResponse.json({
      success: true,
      shipment_id: shipmentId,
      shipment_no,
      updated_fulfillments: updateCount,
      updated_boxes: box_codes?.length || 0,
    });
  } catch (error) {
    console.error('출고 처리 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '출고 처리 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// 와우출고 박스 검사 — 행선지가 쿠팡 센터라 일반 박스와 한 출고번호에 섞지 않고,
//   박스의 일부 행만 출고하면 와우 박스 출고 판정(포장 행 전부 shipment_id)이 어긋난다
//   담기만 한 박스는 이번에 출고하지 않을 수도 있고 서류를 붙이기 전일 수 있다 → [출고준비] 박스만 출고한다
// ============================================================
async function checkWowSelection(ids: string[]): Promise<string | null> {
  const rows = await fetchIn<{ id: string; box_info_id: string | null }>(
    'ft_fulfillment_outbounds', 'id, box_info_id', 'id', ids);
  const wowBoxes = await fetchIn<{ box_info_id: string; ready_at: string | null }>(
    'ft_wow_boxes', 'box_info_id, ready_at', 'box_info_id', rows.map((r) => r.box_info_id ?? ''));
  if (wowBoxes.length === 0) return null;
  if (!wowBoxes.every(wowShippable)) {
    return '와우출고 박스는 출고준비 단계부터 출고할 수 있습니다. 와우출고 화면에서 [출고준비완료] 를 눌러 주세요.';
  }

  const wowIds = new Set(wowBoxes.map((w) => w.box_info_id));
  if (rows.some((r) => !r.box_info_id || !wowIds.has(r.box_info_id))) {
    return '와우출고 박스는 일반 박스와 같은 출고번호로 출고할 수 없습니다. 따로 출고해 주세요.';
  }
  const selected = new Set(ids);
  const boxRows = await fetchIn<{ id: string; shipment_id: string | null }>(
    'ft_fulfillment_outbounds', 'id, shipment_id', 'box_info_id', Array.from(wowIds));
  if (boxRows.some((r) => !r.shipment_id && !selected.has(r.id))) {
    return '와우출고 박스는 박스 통째로 출고해야 합니다. 박스의 상품을 모두 선택해 주세요.';
  }
  return null;
}
