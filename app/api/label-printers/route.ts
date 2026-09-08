import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// PC-NO(작업 자리)별 라벨 프린터 매핑 — label_printers
//
//   GET /api/label-printers?station_no=     목록 (station_no 생략 시 전체)
//   PUT /api/label-printers                 매핑 저장 (upsert)
//        body: { station_no, label_type, qz_printer_name }
//
// station_no 는 화면의 PC-NO(1~4) = 기존 operator_no 와 같은 개념.
// (station_no, label_type) 유니크 → 자리마다 케어/바코드 프린터 1개씩.
// ============================================================

const TABLE = 'label_printers';

export async function GET(request: NextRequest) {
  try {
    const stationNo = new URL(request.url).searchParams.get('station_no');

    let q = supabase.from(TABLE).select('*').order('station_no', { ascending: true });
    if (stationNo) q = q.eq('station_no', Number(stationNo));

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('프린터 매핑 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '프린터 매핑 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { station_no, label_type, qz_printer_name } = await request.json();

    if (!station_no || !label_type) {
      return NextResponse.json(
        { success: false, error: 'station_no와 label_type이 필요합니다.' },
        { status: 400 }
      );
    }

    // 프린터명을 비우면 매핑 해제
    if (!qz_printer_name) {
      const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('station_no', station_no)
        .eq('label_type', label_type);
      if (error) throw error;
      return NextResponse.json({ success: true, data: null });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          station_no,
          label_type,
          qz_printer_name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'station_no,label_type' }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('프린터 매핑 저장 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '프린터 매핑 저장 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
