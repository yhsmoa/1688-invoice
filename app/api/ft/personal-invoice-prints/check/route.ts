import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/ft/personal-invoice-prints/check
//
// 페이지 진입/리프레시 시 호출 — 활성화 판정에 쓰일 prints 데이터 조회.
// personal_order_no 별로 출력된 item_id 집합을 반환.
//
// Request body:
//   {
//     personal_order_nos: string[],
//     user_id: string
//   }
//
// Response:
//   {
//     success: true,
//     printedItemIdsByOrderNo: { [personal_order_no]: string[] }
//   }
//   - 빈 배열 또는 키 부재 = 그 송장에 출력 이력 없음 → 자유 출력 가능
//   - 비어있지 않으면 = 선택된 item_ids 가 그 배열의 부분집합일 때만 재출력 가능
// ============================================================

const PAGE = 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { personal_order_nos, user_id } = body as {
      personal_order_nos?: string[];
      user_id?: string;
    };

    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }
    if (!Array.isArray(personal_order_nos)) {
      return NextResponse.json(
        { success: false, error: 'personal_order_nos 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    // 빈 배열이면 빠른 반환
    if (personal_order_nos.length === 0) {
      return NextResponse.json({
        success: true,
        printedItemIdsByOrderNo: {} as Record<string, string[]>,
      });
    }

    // ── 페이지네이션 조회 (1000건 limit 우회) ──
    // personal_order_no IN (요청받은 nos) 조건으로 필터.
    // user_id 필터도 추가해 다른 사용자 데이터 격리.
    const allRows: { personal_order_no: string; item_id: string }[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('ft_personal_invoice_prints')
        .select('personal_order_no, item_id')
        .eq('user_id', user_id)
        .in('personal_order_no', personal_order_nos)
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allRows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // ── personal_order_no → item_ids[] 매핑 구성 ──
    const map: Record<string, string[]> = {};
    for (const row of allRows) {
      if (!map[row.personal_order_no]) map[row.personal_order_no] = [];
      map[row.personal_order_no].push(row.item_id);
    }

    return NextResponse.json({
      success: true,
      printedItemIdsByOrderNo: map,
    });
  } catch (error) {
    console.error('personal-invoice-prints check 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '운송장 출력 이력 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
