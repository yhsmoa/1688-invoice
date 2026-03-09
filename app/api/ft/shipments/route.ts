import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

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
    if (box_codes && Array.isArray(box_codes) && box_codes.length > 0) {
      const { error: boxErr } = await supabase
        .from('ft_box_info')
        .update({ shipment_id: shipmentId })
        .in('box_code', box_codes);

      if (boxErr) {
        console.error('ft_box_info shipment_id 업데이트 오류:', boxErr);
        // 롤백하지 않고 경고만 — 핵심은 fulfillments 업데이트
      } else {
        console.log(`ft_box_info shipment_id 업데이트: ${box_codes.length}개 박스`);
      }
    }

    // ── 3단계: ft_fulfillments 업데이트 (shipment_no + shipment_id + shipment=true) ──
    //    100개씩 배치 처리 (Supabase .in() 제한 대응)
    const BATCH = 100;
    let updateCount = 0;

    for (let i = 0; i < fulfillment_ids.length; i += BATCH) {
      const batch = fulfillment_ids.slice(i, i + BATCH);
      const { error: ffErr } = await supabase
        .from('ft_fulfillments')
        .update({
          shipment_no,
          shipment_id: shipmentId,
          shipment: true,
        })
        .in('id', batch);

      if (ffErr) {
        console.error('ft_fulfillments 출고 업데이트 오류:', ffErr);
        throw ffErr;
      }
      updateCount += batch.length;
    }

    console.log(`ft_fulfillments 출고 업데이트 완료: ${updateCount}건`);

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
