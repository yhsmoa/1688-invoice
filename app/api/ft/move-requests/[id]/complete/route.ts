import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/move-requests/[id]/complete
//
//   쉽먼트 V2 의 "A 이동요청…" 버튼 → 처리완료 확인
//   판정은 DB 함수 ft_move_request_complete 가 잠금과 함께 수행
//   (supabase/shipment/002_move_requests.sql)
//     · 요청이 미처리(REQUESTED) 이고
//     · 포장 행이 아직 열려 있고(PACKED · 미출고)
//     · 실효 박스 타입(합배송이면 마스터) = 요청 타입 → DONE
//   다르면 409 + "아직 X 박스(BZ-X-01)에 있습니다…" 문구 그대로 전달
//
// Body    : { done_by: string }   — 처리 담당자 (쉽먼트 V2 상단 Worker 선택)
// Response: { success, data?: { id, status, box_code, done_at }, error? }
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB 함수 예외 'request: …' → 화면 문구 */
const toRequestErrorMessage = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const idx = raw.indexOf('request:');
  return idx >= 0 ? raw.slice(idx + 'request:'.length).trim() : null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: '요청 id 가 올바르지 않습니다.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const doneBy = typeof body?.done_by === 'string' ? body.done_by.trim() : '';
    if (!doneBy) {
      return NextResponse.json({ success: false, error: '처리 담당자를 선택해 주세요.' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('ft_move_request_complete', {
      p_request_id: id,
      p_done_by: doneBy,
    });

    if (error) {
      const message = toRequestErrorMessage(error.message);
      if (message) return NextResponse.json({ success: false, error: message }, { status: 409 });
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('move-requests complete 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '이동요청 처리 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
