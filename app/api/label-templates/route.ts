import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// 라벨 템플릿 CRUD — label_templates
//
//   GET    /api/label-templates?user_id=&label_type=   목록
//   POST   /api/label-templates                        생성
//   PATCH  /api/label-templates                        수정 (id 필수)
//   DELETE /api/label-templates?id=                    삭제
//
// user_ids 가 null/빈 배열인 행은 "공용 템플릿" (모든 사용자에게 노출).
// 값이 있으면 그 사용자들 전용 — 한 템플릿을 여러 사업자가 같이 쓸 수도 있다.
//
// is_default 는 "사용자 1명당 (그 라벨종류) 1개" 가 원칙이다. user_ids 가 배열이라
// "같은 그룹"이 DB 인덱스로 표현이 안 돼서(배열 겹침은 유니크 인덱스로 못 잡는다)
// 이 API 가 clearDefault() 로 직접 강제한다:
//   · 공용으로 지정   → 다른 공용 템플릿들의 기본값만 해제 (특정 사용자 기본은 안 건드림)
//   · 특정 사용자들로 지정 → 그 사용자 중 한 명이라도 겹치는 다른 템플릿의 기본값을 해제
//     (그래야 한 사용자가 같은 종류의 기본 템플릿을 2개 갖는 상황이 안 생긴다)
//
// ※ 템플릿/매핑은 수십 건 규모라 1000행 페이지네이션 불필요 (설계상 상한 낮음)
// ============================================================

const TABLE = 'label_templates';

/** is_default 지정 시 같은 그룹(공용 또는 겹치는 사용자)의 기존 기본값 해제 */
async function clearDefault(userIds: string[] | null, labelType: string, exceptId?: string) {
  let q = supabase.from(TABLE).update({ is_default: false }).eq('label_type', labelType).eq('is_default', true);
  q = userIds && userIds.length > 0
    ? q.overlaps('user_ids', userIds)
    : q.or('user_ids.is.null,user_ids.eq.{}');
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw error;
}

/** body 의 user_ids 를 정규화 — 빈 배열은 null(공용)과 같게 취급 */
function normalizeUserIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export async function GET(request: NextRequest) {
  try {
    const p = new URL(request.url).searchParams;
    const userId = p.get('user_id');
    const labelType = p.get('label_type');

    let q = supabase.from(TABLE).select('*').order('created_at', { ascending: true });

    // 특정 사용자 요청 시 = 그 사용자가 포함된 템플릿 + 공용
    if (userId) q = q.or(`user_ids.cs.{${userId}},user_ids.is.null`);
    if (labelType) q = q.eq('label_type', labelType);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error) {
    console.error('라벨 템플릿 조회 오류:', error);
    return NextResponse.json(
      { success: false, error: '라벨 템플릿 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_ids: rawUserIds = null,
      name,
      label_type,
      width_mm,
      height_mm,
      gap_mm = 2,
      media = 'gap',
      cutter = 'off',
      dpi = 203,
      density = null,
      speed = null,
      layout = [],
      is_default = false,
    } = body;
    const user_ids = normalizeUserIds(rawUserIds);

    if (!name || !label_type) {
      return NextResponse.json(
        { success: false, error: '이름과 라벨 종류는 필수입니다.' },
        { status: 400 }
      );
    }

    if (is_default) await clearDefault(user_ids, label_type);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_ids,
        name,
        label_type,
        printer_lang: 'TSPL2',
        width_mm,
        height_mm,
        gap_mm,
        media,
        cutter,
        dpi,
        density,
        speed,
        layout,
        is_default,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('라벨 템플릿 생성 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '라벨 템플릿 생성 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...rest } = body;
    if (!id) {
      return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 });
    }
    const fields = 'user_ids' in rest ? { ...rest, user_ids: normalizeUserIds(rest.user_ids) } : rest;

    // 기본 템플릿으로 지정하는 경우 같은 그룹 해제 먼저
    if (fields.is_default) {
      const { data: cur } = await supabase
        .from(TABLE)
        .select('user_ids, label_type')
        .eq('id', id)
        .maybeSingle();
      const userIds = 'user_ids' in fields ? fields.user_ids : (cur?.user_ids ?? null);
      const labelType = fields.label_type ?? cur?.label_type;
      if (labelType) await clearDefault(userIds, labelType, id);
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('라벨 템플릿 수정 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '라벨 템플릿 수정 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 });
    }
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('라벨 템플릿 삭제 오류:', error);
    return NextResponse.json(
      { success: false, error: '라벨 템플릿 삭제 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
