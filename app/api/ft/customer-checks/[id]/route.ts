import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import {
  CHECK_ACTION_FROM,
  isCheckAction,
  reopenTarget,
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
//   PATCH : 창고 상태 전이 { action: 'close' | 'reopen', comment?, author_name? }
//           허용 전이는 lib/customerChecks.CHECK_ACTION_FROM — 조건부 UPDATE 로 강제 (0행 → 409)
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
//   close  : 확인요청(잘못 보낸 요청 회수)·재문의·답변완료 → 처리완료 (closed_at = now)
//   reopen : 처리완료 → 고객 선택에 따른 원래 단계 (lib reopenTarget — DB 정합 제약과 같은 규칙)
//            선택 없음 → 확인요청 · 재문의 → 재문의 · 출고/취소 → 답변완료 (closed_at = NULL)
//
//   UPDATE … WHERE id = ? AND status IN (from) 로 한 번에 처리 → 다른 사람이 먼저 바꿨으면 0행 = 409.
//   comment 가 있으면 전이 성공 후 창고 댓글로 저장. 댓글 저장만 실패하면 상태는 바뀐 채 500 으로 알린다.
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
      return NextResponse.json({ success: false, error: 'action 값이 올바르지 않습니다. (close / reopen)' }, { status: 400 });
    }
    const comment = str(body?.comment);
    const authorName = str(body?.author_name);

    // ── 현재 건 (reopen 목표 계산 + 409 안내용) ──
    const { data: cur, error: curErr } = await supabase
      .from('ft_customer_checks')
      .select('id, status, decision')
      .eq('id', id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!cur) {
      return NextResponse.json({ success: false, error: '확인요청을 찾을 수 없습니다.' }, { status: 404 });
    }
    const current = cur as Pick<CustomerCheckRow, 'id' | 'status' | 'decision'>;

    const patch: Record<string, unknown> =
      action === 'close'
        ? { status: '처리완료', closed_at: new Date().toISOString() }
        : { status: reopenTarget(current.decision), closed_at: null };

    // 조건부 UPDATE — 위에서 읽은 뒤 다른 사람이 바꿨어도 from 조건이 막는다.
    //   reopen 은 decision 도 조건에 넣는다: 목표 단계를 decision 으로 계산했으므로 그 사이 바뀌면 0행.
    let upd = supabase
      .from('ft_customer_checks')
      .update(patch)
      .eq('id', id)
      .in('status', [...CHECK_ACTION_FROM[action]]);
    if (action === 'reopen') {
      upd = current.decision === null ? upd.is('decision', null) : upd.eq('decision', current.decision);
    }
    const { data: updated, error: updErr } = await upd.select('*');
    if (updErr) throw updErr;

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, error: `현재 상태(${current.status})에서는 이 동작을 할 수 없습니다. 새로고침 후 다시 확인해 주세요.`, status: current.status },
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
          { success: false, error: `상태는 '${patch.status}' 로 바뀌었지만 댓글 저장에 실패했습니다: ${cmErr.message}` },
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
