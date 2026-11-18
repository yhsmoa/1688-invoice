import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../../lib/supabase';
import { fail, serverError } from '../../storageShared';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/storage/wow/docs?box_id=&kind=label|manifest
//   와우 박스 서류(부착문서 label · 동봉문서 manifest) — 로켓이 private 버킷 wow-docs 에 올린 PDF
//   → service role signed URL(10분)로 redirect. 화면은 링크를 새 탭으로 연다 (URL 이 만료돼도 다시 누르면 새로 발급)
// ============================================================

const BUCKET = 'wow-docs';
const SIGNED_URL_EXPIRES_IN = 600;

export async function GET(request: NextRequest) {
  const boxId = request.nextUrl.searchParams.get('box_id');
  const kind = request.nextUrl.searchParams.get('kind');
  if (!boxId || (kind !== 'label' && kind !== 'manifest')) return fail('box_id, kind(label|manifest) 가 필요합니다.');

  try {
    const { data: box, error } = await supabase
      .from('ft_wow_boxes')
      .select('label_path, manifest_path')
      .eq('id', boxId)
      .maybeSingle();
    if (error) throw error;
    const path = kind === 'label' ? box?.label_path : box?.manifest_path;
    if (!path) return fail('등록된 서류가 없습니다.', 404);

    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_EXPIRES_IN);
    if (signErr) throw signErr;
    return NextResponse.redirect(signed.signedUrl);
  } catch (error) {
    return serverError('와우출고 서류 조회', error);
  }
}
