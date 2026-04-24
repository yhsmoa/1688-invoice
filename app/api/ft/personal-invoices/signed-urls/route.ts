import { NextRequest, NextResponse } from 'next/server';
import { getStockSupabase, PERSONAL_INVOICE_BUCKET } from '../../../../../lib/stockSupabase';

// ============================================================
// POST /api/ft/personal-invoices/signed-urls
//
// 체크된 P(PERSONAL) 상품의 personal_order_no 파일별 signed URL 발급.
//
// Request body:
//   { order_user_id: string, order_nos: string[] }
//
// Response:
//   { success: true, urls: { [order_no]: string | null } }
//
// 처리 흐름:
//   1. si_users.order_user_id → si_users.id 매핑 조회
//   2. createSignedUrls 로 일괄 URL 발급 (10분 만료)
//   3. 파일 미존재 건은 null 로 반환 (클라이언트에서 skip)
// ============================================================

const SIGNED_URL_EXPIRES_IN = 600; // 10분
const BATCH_SIZE = 100;            // createSignedUrls 배치 크기

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

    if (!Array.isArray(order_nos) || order_nos.length === 0) {
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
      // 매핑 없음 → 전부 null
      const urls: Record<string, string | null> = {};
      for (const no of order_nos) urls[no] = null;
      return NextResponse.json({ success: true, urls });
    }

    const siUserId = siUser.id as string;

    // ── Step 2: createSignedUrls 배치 호출 ──
    const urls: Record<string, string | null> = {};
    for (let i = 0; i < order_nos.length; i += BATCH_SIZE) {
      const batch = order_nos.slice(i, i + BATCH_SIZE);
      const paths = batch.map((no) => `${siUserId}/${no}.pdf`);

      const { data, error } = await stockSupabase.storage
        .from(PERSONAL_INVOICE_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);

      if (error) {
        console.error('createSignedUrls 오류:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Signed URL 발급 중 오류가 발생했습니다.',
            details: (error as unknown as Record<string, unknown>)?.message ?? JSON.stringify(error),
          },
          { status: 500 }
        );
      }

      // createSignedUrls 응답은 입력 path 순서 그대로 반환
      (data ?? []).forEach((row, idx) => {
        const orderNo = batch[idx];
        // row.error 존재 or signedUrl 없음 → null 처리 (파일 미존재 등)
        if (row.error || !row.signedUrl) {
          urls[orderNo] = null;
        } else {
          urls[orderNo] = row.signedUrl;
        }
      });
    }

    return NextResponse.json({ success: true, urls });
  } catch (error) {
    console.error('personal-invoices signed-urls 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '송장 signed URL 발급 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
