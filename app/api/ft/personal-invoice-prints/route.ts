import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// ============================================================
// POST /api/ft/personal-invoice-prints
//
// 운송장 출력 성공 후 호출 — N개 item 에 대해 prints 행 UPSERT.
// 같은 (personal_order_no, item_id) 가 이미 있으면 printed_at / printed_by 만 갱신.
// 첫 출력 시 INSERT, 재출력 시 UPDATE 효과.
//
// Request body:
//   {
//     personal_order_no: string,
//     item_ids: string[],
//     user_id: string,
//     printed_by?: string | null
//   }
//
// Response:
//   { success: true, count: number, mode: 'inserted' | 'updated' | 'mixed' }
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { personal_order_no, item_ids, user_id, printed_by } = body as {
      personal_order_no?: string;
      item_ids?: string[];
      user_id?: string;
      printed_by?: string | null;
    };

    // ── 입력 검증 ──
    if (!personal_order_no || typeof personal_order_no !== 'string') {
      return NextResponse.json(
        { success: false, error: 'personal_order_no가 필요합니다.' },
        { status: 400 }
      );
    }
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'item_ids 배열이 필요합니다.' },
        { status: 400 }
      );
    }
    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── UPSERT — onConflict 로 (personal_order_no, item_id) 중복 시 갱신 ──
    const rows = item_ids.map((id) => ({
      personal_order_no,
      item_id: id,
      user_id,
      printed_by: printed_by ?? null,
      printed_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('ft_personal_invoice_prints')
      .upsert(rows, { onConflict: 'personal_order_no,item_id' })
      .select('id');

    if (error) {
      console.error('ft_personal_invoice_prints UPSERT 오류:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      count: data?.length ?? 0,
    });
  } catch (error) {
    console.error('personal-invoice-prints POST 처리 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '운송장 출력 기록 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
