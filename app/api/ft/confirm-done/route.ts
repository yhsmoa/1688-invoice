import { NextRequest, NextResponse } from 'next/server';
import { confirmDoneForUser } from '../../../../lib/confirmDone';

// ============================================================
// POST /api/ft/confirm-done
// PROCESSING 상태인 ft_order_items 중
// order_qty - CANCEL수량 - 출고완료PACKED수량 = 0 인 항목을 DONE으로 변경
//
// Body: { user_id: string }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    const { updated, total } = await confirmDoneForUser(user_id);

    if (updated === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        total,
        message: total === 0 ? 'PROCESSING 항목이 없습니다.' : '확정할 항목이 없습니다.',
      });
    }

    return NextResponse.json({
      success: true,
      updated,
      total,
      message: `${updated}개 항목이 DONE 처리되었습니다.`,
    });
  } catch (error) {
    console.error('confirm-done 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확정 처리 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
