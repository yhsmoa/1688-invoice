import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../../lib/supabase';
import type { CustomerCheckComment } from '../../../../../../lib/customerChecks';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/customer-checks/[id]/comments — 창고 댓글 추가
//
//   Body: { body: string, author_name?: string }
//   상태는 바꾸지 않는다 (어느 상태에서나 가능). 고객 댓글은 purchase-agent 가 DB 함수로 남긴다.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 2000;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'id 가 올바르지 않습니다.' }, { status: 400 });
    }

    const json = await request.json().catch(() => null) as { body?: unknown; author_name?: unknown } | null;
    const body = typeof json?.body === 'string' ? json.body.trim() : '';
    if (!body) {
      return NextResponse.json({ success: false, error: '댓글 내용을 입력하세요.' }, { status: 400 });
    }
    if (body.length > MAX_BODY) {
      return NextResponse.json({ success: false, error: `댓글은 ${MAX_BODY}자 이내로 입력하세요.` }, { status: 400 });
    }
    const authorName = typeof json?.author_name === 'string' && json.author_name.trim() ? json.author_name.trim() : null;

    const { data, error } = await supabase
      .from('ft_customer_check_comments')
      .insert({ check_id: id, author_role: 'warehouse', author_name: authorName, body })
      .select('*')
      .single();
    if (error) {
      // FK 위반 = 없는 건
      if (/foreign key/i.test(error.message)) {
        return NextResponse.json({ success: false, error: '확인요청을 찾을 수 없습니다.' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, comment: data as CustomerCheckComment });
  } catch (error) {
    console.error('customer-checks/[id]/comments POST 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '댓글 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
