import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import {
  CHECK_TRANSITIONS,
  isCheckAction,
  type CustomerCheckComment,
  type CustomerCheckDetail,
  type CustomerCheckImage,
  type CustomerCheckRow,
} from '../../../../../lib/customerChecks';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/customer-checks/[id]
//
//   GET   : 건 + 댓글 + 이미지 + 같은 아이템번호의 다른 요청
//   PATCH : 창고 상태 전이 { action: 'recheck' | 'close' | 'reopen', comment?, author_name? }
//           허용 전이는 lib/customerChecks.CHECK_TRANSITIONS — 조건부 UPDATE 로 강제 (0행 → 409)
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATED_LIMIT = 10;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'id 가 올바르지 않습니다.' }, { status: 400 });
    }

    const { data: check, error: checkErr } = await supabase
      .from('ft_customer_checks')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (checkErr) throw checkErr;
    if (!check) {
      return NextResponse.json({ success: false, error: '확인요청을 찾을 수 없습니다.' }, { status: 404 });
    }
    const row = check as CustomerCheckRow;

    // 댓글은 한 건당 수십 개 수준 — 1000행 제한에 걸릴 규모가 아니므로 단건 조회
    const [commentsRes, imagesRes, relatedRes] = await Promise.all([
      supabase.from('ft_customer_check_comments').select('*').eq('check_id', id).order('created_at', { ascending: true }),
      supabase.from('ft_customer_check_images').select('*').eq('check_id', id).order('sort_order', { ascending: true }),
      row.item_no
        ? supabase
            .from('ft_customer_checks')
            .select('id, status, decision, created_at, team_code')
            .eq('item_no', row.item_no)
            .neq('id', id)
            .order('created_at', { ascending: false })
            .limit(RELATED_LIMIT)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (commentsRes.error) throw commentsRes.error;
    if (imagesRes.error) throw imagesRes.error;
    if (relatedRes.error) throw relatedRes.error;

    const detail: CustomerCheckDetail = {
      check: row,
      comments: (commentsRes.data ?? []) as CustomerCheckComment[],
      images: (imagesRes.data ?? []) as CustomerCheckImage[],
      related: (relatedRes.data ?? []) as CustomerCheckDetail['related'],
    };
    return NextResponse.json({ success: true, ...detail });
  } catch (error) {
    console.error('customer-checks/[id] GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '확인요청을 불러오는 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH — 창고 상태 전이
//
//   recheck : 답변완료 → 재확인요청 (댓글 필수 — 무엇을 다시 확인할지)
//   close   : 확인요청·재확인요청·답변완료 → 처리완료 (closed_at = now)
//   reopen  : 처리완료 → 재확인요청 (closed_at = NULL)
//
//   UPDATE … WHERE id = ? AND status IN (from) 로 한 번에 처리 → 다른 사람이 먼저 바꿨으면 0행 = 409.
//   댓글은 전이 성공 후 저장 (warehouse). 댓글 저장만 실패하면 상태는 바뀐 채 500 으로 알린다.
// ============================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: 'id 가 올바르지 않습니다.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null) as
      | { action?: unknown; comment?: unknown; author_name?: unknown }
      | null;
    const action = body?.action;
    if (!isCheckAction(action)) {
      return NextResponse.json({ success: false, error: 'action 값이 올바르지 않습니다. (recheck / close / reopen)' }, { status: 400 });
    }
    const comment = str(body?.comment);
    const authorName = str(body?.author_name);
    const rule = CHECK_TRANSITIONS[action];
    if (rule.commentRequired && !comment) {
      return NextResponse.json({ success: false, error: '재확인요청에는 다시 확인할 내용을 댓글로 적어야 합니다.' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { status: rule.to };
    if (action === 'close') patch.closed_at = new Date().toISOString();
    if (action === 'reopen') patch.closed_at = null;

    const { data: updated, error: updErr } = await supabase
      .from('ft_customer_checks')
      .update(patch)
      .eq('id', id)
      .in('status', [...rule.from])
      .select('*');
    if (updErr) throw updErr;

    if (!updated || updated.length === 0) {
      // 전이 조건 불일치 — 현재 상태를 알려준다 (없으면 404)
      const { data: cur, error: curErr } = await supabase
        .from('ft_customer_checks')
        .select('status')
        .eq('id', id)
        .maybeSingle();
      if (curErr) throw curErr;
      if (!cur) {
        return NextResponse.json({ success: false, error: '확인요청을 찾을 수 없습니다.' }, { status: 404 });
      }
      return NextResponse.json(
        { success: false, error: `현재 상태(${cur.status})에서는 이 동작을 할 수 없습니다. 새로고침 후 다시 확인해 주세요.`, status: cur.status },
        { status: 409 }
      );
    }

    if (comment) {
      const { error: cmErr } = await supabase.from('ft_customer_check_comments').insert({
        check_id: id,
        author_role: 'warehouse',
        author_name: authorName,
        body: comment,
      });
      if (cmErr) {
        console.error('customer-checks PATCH 댓글 저장 오류:', cmErr);
        return NextResponse.json(
          { success: false, error: `상태는 '${rule.to}' 로 바뀌었지만 댓글 저장에 실패했습니다: ${cmErr.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, check: updated[0] as CustomerCheckRow });
  } catch (error) {
    console.error('customer-checks/[id] PATCH 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '상태 변경 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
