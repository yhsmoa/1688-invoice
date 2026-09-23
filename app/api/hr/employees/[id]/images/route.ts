import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../../lib/supabase';
import {
  HR_DOCS_BUCKET,
  SIGNED_URL_TTL_SEC,
  MAX_IMAGE_BYTES,
  IMAGE_EXT_BY_MIME,
  EMPLOYEE_IMAGE_COLUMNS,
  EMPLOYEE_IMAGE_KINDS,
  isEmployeeImageKind,
  type EmployeeImageKind,
} from '../../../../../../lib/hrEmployeeImages';

// 매 요청 signed URL 을 새로 발급해야 하므로 정적 캐시 금지
export const dynamic = 'force-dynamic';

type ImagePaths = Record<string, string | null>;

// ============================================================
// 공통 — 직원의 이미지 경로 3종 조회
// ============================================================
async function fetchImagePaths(id: string): Promise<ImagePaths | null> {
  const { data, error } = await supabase
    .from('invoiceManager_employees')
    .select(Object.values(EMPLOYEE_IMAGE_COLUMNS).join(', '))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as ImagePaths | null) ?? null;
}

const errorResponse = (message: string, status: number, error?: unknown) =>
  NextResponse.json(
    {
      success: false,
      error: message,
      ...(error ? { details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error) } : {}),
    },
    { status }
  );

// ============================================================
// GET /api/hr/employees/[id]/images
// 이미지 3종 signed URL — { photo, id_front, id_back } (없으면 null)
// ============================================================
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const paths = await fetchImagePaths(params.id);
    if (!paths) return errorResponse('직원을 찾을 수 없습니다.', 404);

    const urls: Record<EmployeeImageKind, string | null> = { photo: null, id_front: null, id_back: null };
    const targets = EMPLOYEE_IMAGE_KINDS
      .map((kind) => ({ kind, path: paths[EMPLOYEE_IMAGE_COLUMNS[kind]] }))
      .filter((t): t is { kind: EmployeeImageKind; path: string } => !!t.path);

    if (targets.length > 0) {
      const { data, error } = await supabase.storage
        .from(HR_DOCS_BUCKET)
        .createSignedUrls(targets.map((t) => t.path), SIGNED_URL_TTL_SEC);
      if (error) throw error;
      // 응답 순서는 요청 순서와 같지만, path 로 다시 맞춰 안전하게 매핑한다
      const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      for (const t of targets) urls[t.kind] = byPath.get(t.path) ?? null;
    }

    return NextResponse.json({ success: true, data: urls });
  } catch (error) {
    console.error('직원 이미지 조회 오류:', error);
    return errorResponse('직원 이미지를 불러오는 중 오류가 발생했습니다.', 500, error);
  }
}

// ============================================================
// POST /api/hr/employees/[id]/images   (multipart/form-data: kind, file)
// 업로드 → 칼럼 갱신 → 이전 파일 삭제
//   · 칼럼 갱신이 실패하면 방금 올린 파일을 지워 고아 객체를 남기지 않는다
//   · 이전 파일 삭제 실패는 응답을 실패로 만들지 않는다 (새 이미지는 이미 반영됨)
// ============================================================
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const form = await request.formData();
    const kind = form.get('kind');
    const file = form.get('file');

    // ── 입력 검증 ──
    if (!isEmployeeImageKind(kind)) return errorResponse('이미지 종류가 올바르지 않습니다.', 400);
    if (!(file instanceof File)) return errorResponse('파일이 없습니다.', 400);
    const ext = IMAGE_EXT_BY_MIME[file.type];
    if (!ext) return errorResponse('JPG · PNG · WEBP 이미지만 올릴 수 있습니다.', 400);
    if (file.size > MAX_IMAGE_BYTES) return errorResponse('이미지 용량이 5MB 를 넘습니다.', 400);

    const paths = await fetchImagePaths(id);
    if (!paths) return errorResponse('직원을 찾을 수 없습니다.', 404);

    const column = EMPLOYEE_IMAGE_COLUMNS[kind];
    const oldPath = paths[column];
    const newPath = `${id}/${kind}-${Date.now()}.${ext}`;

    // ── 1) 업로드 ──
    const { error: uploadErr } = await supabase.storage
      .from(HR_DOCS_BUCKET)
      .upload(newPath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (uploadErr) throw uploadErr;

    // ── 2) 칼럼 갱신 (실패 시 방금 올린 파일 회수) ──
    const { error: updateErr } = await supabase
      .from('invoiceManager_employees')
      .update({ [column]: newPath })
      .eq('id', id);
    if (updateErr) {
      await supabase.storage.from(HR_DOCS_BUCKET).remove([newPath]);
      throw updateErr;
    }

    // ── 3) 이전 파일 삭제 ──
    if (oldPath && oldPath !== newPath) {
      const { error: removeErr } = await supabase.storage.from(HR_DOCS_BUCKET).remove([oldPath]);
      if (removeErr) console.error('이전 직원 이미지 삭제 실패:', oldPath, removeErr);
    }

    return NextResponse.json({ success: true, kind, path: newPath });
  } catch (error) {
    console.error('직원 이미지 업로드 오류:', error);
    return errorResponse('직원 이미지 업로드 중 오류가 발생했습니다.', 500, error);
  }
}

// ============================================================
// DELETE /api/hr/employees/[id]/images?kind=photo|id_front|id_back
// 칼럼 비움 → 파일 삭제
// ============================================================
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  try {
    const kind = new URL(request.url).searchParams.get('kind');
    if (!isEmployeeImageKind(kind)) return errorResponse('이미지 종류가 올바르지 않습니다.', 400);

    const paths = await fetchImagePaths(id);
    if (!paths) return errorResponse('직원을 찾을 수 없습니다.', 404);

    const column = EMPLOYEE_IMAGE_COLUMNS[kind];
    const oldPath = paths[column];
    if (!oldPath) return NextResponse.json({ success: true, kind });

    const { error: updateErr } = await supabase
      .from('invoiceManager_employees')
      .update({ [column]: null })
      .eq('id', id);
    if (updateErr) throw updateErr;

    const { error: removeErr } = await supabase.storage.from(HR_DOCS_BUCKET).remove([oldPath]);
    if (removeErr) console.error('직원 이미지 파일 삭제 실패:', oldPath, removeErr);

    return NextResponse.json({ success: true, kind });
  } catch (error) {
    console.error('직원 이미지 삭제 오류:', error);
    return errorResponse('직원 이미지 삭제 중 오류가 발생했습니다.', 500, error);
  }
}
