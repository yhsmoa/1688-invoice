import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/db/account-info — 계좌정보 (ft_account_info)
//
//   GET                      → 전체 목록 (최근 등록순, 1000행 페이징 루프)
//   POST   { fields }        → 신규 등록
//   PATCH  { id, fields }    → 수정
//   DELETE ?id=…             → 삭제
//
//   접근 코드 없이 누구나 사용 (운영 요청) — 화면도 잠금 없음
//   테이블은 RLS 정책이 없어 anon 키로는 직접 접근 불가, 이 라우트(service role)로만 읽고 쓴다
// ============================================================

const TABLE = 'ft_account_info';
const PAGE = 1000;

const SELECT_COLS = 'id, company_name, name, phone, bank_name, account_no, note, created_at, updated_at';

// ── 입력 받는 필드 (화이트리스트) ──
const EDITABLE_FIELDS = ['company_name', 'name', 'phone', 'bank_name', 'account_no', 'note'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

// ── 비고를 뺀 정보 필드 — 이 중 하나는 있어야 저장 (빈 행 방지) ──
const INFO_FIELDS: readonly EditableField[] = ['company_name', 'name', 'phone', 'bank_name', 'account_no'];

// ── 길이 제한 (오입력·붙여넣기 사고 방지) ──
const MAX_LEN: Record<EditableField, number> = {
  company_name: 100,
  name: 100,
  phone: 50,
  bank_name: 100,
  account_no: 50,
  note: 1000,
};

class InputError extends Error {}

// ============================================================
// 입력 정규화 — 화이트리스트 필드만, 앞뒤 공백 제거, 빈 문자열은 null
// ============================================================
function normalizeFields(raw: unknown): Record<EditableField, string | null> {
  if (!raw || typeof raw !== 'object') throw new InputError('입력값이 올바르지 않습니다.');
  const src = raw as Record<string, unknown>;

  const out = {} as Record<EditableField, string | null>;
  for (const f of EDITABLE_FIELDS) {
    const v = src[f];
    const s = v == null ? '' : String(v).trim();
    if (s.length > MAX_LEN[f]) throw new InputError(`입력값이 너무 깁니다. (${f}: 최대 ${MAX_LEN[f]}자)`);
    out[f] = s || null;
  }

  if (INFO_FIELDS.every((f) => !out[f])) {
    throw new InputError('회사이름·이름·연락처·은행·계좌번호 중 하나 이상 입력해주세요.');
  }
  return out;
}

// ============================================================
// GET — 전체 목록
// ============================================================
export async function GET() {
  try {
    const all: Record<string, unknown>[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(SELECT_COLS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return NextResponse.json({ success: true, data: all });
  } catch (error) {
    console.error('계좌정보 조회 오류:', error);
    return NextResponse.json({ success: false, error: '계좌정보를 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ============================================================
// POST — 신규 등록
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fields = normalizeFields(body?.fields);

    const { data, error } = await supabase
      .from(TABLE)
      .insert(fields)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('계좌정보 등록 오류:', error);
    return NextResponse.json({ success: false, error: '계좌정보 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ============================================================
// PATCH — 수정
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) throw new InputError('수정할 항목 id 가 필요합니다.');
    const fields = normalizeFields(body?.fields);

    const { data, error } = await supabase
      .from(TABLE)
      .update(fields)
      .eq('id', id)
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ success: false, error: '수정할 항목을 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof InputError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('계좌정보 수정 오류:', error);
    return NextResponse.json({ success: false, error: '계좌정보 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ============================================================
// DELETE — 삭제
// ============================================================
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!id) {
      return NextResponse.json({ success: false, error: '삭제할 항목 id 가 필요합니다.' }, { status: 400 });
    }

    const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ success: false, error: '삭제할 항목을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('계좌정보 삭제 오류:', error);
    return NextResponse.json({ success: false, error: '계좌정보 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
