import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import type { LabelAudience } from '../../../lib/labelTypes';

export const dynamic = 'force-dynamic';

// ============================================================
// 라벨 템플릿 CRUD — label_templates
//
//   GET    /api/label-templates?user_id=&label_type=&audience=   목록
//   POST   /api/label-templates                                  생성
//   PATCH  /api/label-templates                                  수정 (id 필수)
//   DELETE /api/label-templates?id=                              삭제
//
// user_ids 가 null/빈 배열인 행은 "공용 템플릿" (모든 사용자에게 노출).
// 값이 있으면 그 사용자들 전용 — 한 템플릿을 여러 사업자가 같이 쓸 수도 있다.
//
// audiences 는 대상(성인 adult / 키즈 kids). 빈 값은 허용하지 않고 성인으로 정규화한다.
// description 은 작업자용 설명(중국어) — 드롭다운 두 번째 줄.
//
// is_default 는 "사용자 1명당 (그 라벨종류·대상) 1개" 가 원칙이다. user_ids/audiences 가
// 배열이라 "같은 그룹"이 DB 인덱스로 표현이 안 돼서(배열 겹침은 유니크 인덱스로 못 잡는다)
// 이 API 가 clearDefault() 로 직접 강제한다:
//   · 공용으로 지정   → 다른 공용 템플릿들의 기본값만 해제 (특정 사용자 기본은 안 건드림)
//   · 특정 사용자들로 지정 → 그 사용자 중 한 명이라도 겹치는 다른 템플릿의 기본값을 해제
//   · 대상이 겹치는 것만 해제 → 성인 기본과 키즈 기본은 따로 둘 수 있다
//
// ※ 템플릿/매핑은 수십 건 규모라 1000행 페이지네이션 불필요 (설계상 상한 낮음)
// ============================================================

const TABLE = 'label_templates';
const AUDIENCE_KEYS: LabelAudience[] = ['adult', 'kids'];

/** is_default 지정 시 같은 그룹(공용 또는 겹치는 사용자 · 겹치는 대상)의 기존 기본값 해제 */
async function clearDefault(
  userIds: string[] | null,
  labelType: string,
  audiences: LabelAudience[],
  exceptId?: string
) {
  let q = supabase
    .from(TABLE)
    .update({ is_default: false })
    .eq('label_type', labelType)
    .eq('is_default', true)
    .overlaps('audiences', audiences);
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

/** body 의 audiences 를 정규화 — 알 수 없는 값 제거, 비면 성인 */
function normalizeAudiences(value: unknown): LabelAudience[] {
  const list = Array.isArray(value)
    ? value.filter((v): v is LabelAudience => AUDIENCE_KEYS.includes(v as LabelAudience))
    : [];
  return list.length > 0 ? Array.from(new Set(list)) : ['adult'];
}

/** 설명 — 공백만 있으면 null */
function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

export async function GET(request: NextRequest) {
  try {
    const p = new URL(request.url).searchParams;
    const userId = p.get('user_id');
    const labelType = p.get('label_type');
    const audience = p.get('audience');

    let q = supabase.from(TABLE).select('*').order('created_at', { ascending: true });

    // 특정 사용자 요청 시 = 그 사용자가 포함된 템플릿 + 공용
    if (userId) q = q.or(`user_ids.cs.{${userId}},user_ids.is.null`);
    if (labelType) q = q.eq('label_type', labelType);
    if (audience && AUDIENCE_KEYS.includes(audience as LabelAudience)) {
      q = q.contains('audiences', [audience]);
    }

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
      description: rawDescription = null,
      audiences: rawAudiences = null,
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
    const audiences = normalizeAudiences(rawAudiences);
    const description = normalizeDescription(rawDescription);

    if (!name || !label_type) {
      return NextResponse.json(
        { success: false, error: '이름과 라벨 종류는 필수입니다.' },
        { status: 400 }
      );
    }

    if (is_default) await clearDefault(user_ids, label_type, audiences);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_ids,
        name,
        description,
        audiences,
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
    const fields: Record<string, unknown> = { ...rest };
    if ('user_ids' in fields) fields.user_ids = normalizeUserIds(fields.user_ids);
    if ('audiences' in fields) fields.audiences = normalizeAudiences(fields.audiences);
    if ('description' in fields) fields.description = normalizeDescription(fields.description);

    // 기본 템플릿으로 지정하는 경우 같은 그룹 해제 먼저
    if (fields.is_default) {
      const { data: cur } = await supabase
        .from(TABLE)
        .select('user_ids, label_type, audiences')
        .eq('id', id)
        .maybeSingle();
      const userIds = ('user_ids' in fields ? fields.user_ids : cur?.user_ids ?? null) as string[] | null;
      const labelType = (fields.label_type ?? cur?.label_type) as string | undefined;
      const audiences = normalizeAudiences('audiences' in fields ? fields.audiences : cur?.audiences);
      if (labelType) await clearDefault(userIds, labelType, audiences, id);
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
