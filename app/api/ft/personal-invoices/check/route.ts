import { NextRequest, NextResponse } from 'next/server';
import { getStockSupabase, PERSONAL_INVOICE_BUCKET } from '../../../../../lib/stockSupabase';

// ============================================================
// POST /api/ft/personal-invoices/check
//
// 체크된 P(PERSONAL) 상품의 personal_order_no 별 Storage PDF 존재 여부 조회.
//
// Request body:
//   { order_user_id: string, order_nos: string[] }
//
// Response:
//   { success: true, exists: { [order_no]: boolean }, si_user_id: string | null }
//
// 처리 흐름:
//   1. stock_management.si_users 테이블에서 order_user_id → id 매핑 조회
//      (ft_users.id == si_users.order_user_id, Storage 폴더명 = si_users.id)
//   2. Storage personal-order-invoices 버킷의 {si_user_id} 폴더 파일 목록 조회
//      - 1000건 페이징 필요시 offset 루프
//   3. order_nos 각각 `${order_no}.pdf` 존재 여부 판단
// ============================================================

const PAGE_SIZE = 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_user_id, order_nos } = body as {
      order_user_id?: string;
      order_nos?: string[];
    };

    if (!order_user_id || typeof order_user_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'order_user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    if (!Array.isArray(order_nos)) {
      return NextResponse.json(
        { success: false, error: 'order_nos 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    const stockSupabase = getStockSupabase();

    // ── Step 1: si_users.order_user_id → si_users.id 매핑 조회 ──
    const { data: siUser, error: siErr } = await stockSupabase
      .from('si_users')
      .select('id')
      .eq('order_user_id', order_user_id)
      .maybeSingle();

    if (siErr) {
      console.error('si_users 매핑 조회 오류:', siErr);
      return NextResponse.json(
        {
          success: false,
          error: 'si_users 조회 중 오류가 발생했습니다.',
          details: (siErr as unknown as Record<string, unknown>)?.message ?? JSON.stringify(siErr),
        },
        { status: 500 }
      );
    }

    if (!siUser || !siUser.id) {
      // 매핑 없음 → 전부 false
      const exists: Record<string, boolean> = {};
      for (const no of order_nos) exists[no] = false;
      return NextResponse.json({ success: true, exists, si_user_id: null });
    }

    const siUserId = siUser.id as string;

    // ── Step 2: Storage 폴더 파일 목록 조회 (1000건 페이징) ──
    const fileNameSet = new Set<string>();
    let offset = 0;
    while (true) {
      const { data: files, error: listErr } = await stockSupabase.storage
        .from(PERSONAL_INVOICE_BUCKET)
        .list(siUserId, { limit: PAGE_SIZE, offset });

      if (listErr) {
        console.error('Storage list 오류:', listErr);
        return NextResponse.json(
          {
            success: false,
            error: 'Storage 파일 목록 조회 중 오류가 발생했습니다.',
            details: (listErr as unknown as Record<string, unknown>)?.message ?? JSON.stringify(listErr),
          },
          { status: 500 }
        );
      }

      if (!files || files.length === 0) break;

      for (const f of files) {
        if (f.name) fileNameSet.add(f.name);
      }

      if (files.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // ── Step 3: order_nos 각각 존재 여부 판단 ──
    const exists: Record<string, boolean> = {};
    for (const no of order_nos) {
      exists[no] = fileNameSet.has(`${no}.pdf`);
    }

    return NextResponse.json({
      success: true,
      exists,
      si_user_id: siUserId,
    });
  } catch (error) {
    console.error('personal-invoices check 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '송장 존재 여부 조회 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
