import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import {
  SELLER_INQUIRY_BUCKET,
  SELLER_INQUIRY_MAX_PHOTOS,
  SELLER_INQUIRY_TABLES as T,
  type SellerInquiryPhotoRow,
} from '../../../../../lib/sellerInquiries';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/seller-inquiries/photos — 사진 첨부 (multipart)
//
//   - inquiry_id : 접수 id                          필수
//   - taken_by   : 촬영 작업자 이름                  선택
//   - photo      : 이미지 파일 × 1~N (같은 필드명 여러 개)
//
//   처리: Storage 공개 버킷 seller-inquiry/{inquiry_id}/{ts}-{n}.{ext} 업로드 → ft_seller_inquiry_photos 행.
//   하나라도 실패하면 이번에 올린 파일·행을 지워 반만 남지 않게 한다.
//   접수가 처리완료면 거부 (닫힌 건에 사진이 붙지 않게).
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const uploadedPaths: string[] = [];
  try {
    const form = await request.formData();
    const inquiryId = String(form.get('inquiry_id') ?? '').trim();
    const takenBy = String(form.get('taken_by') ?? '').trim() || null;
    const files = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);

    if (!UUID_RE.test(inquiryId)) {
      return NextResponse.json({ success: false, error: '접수 id 가 올바르지 않습니다.' }, { status: 400 });
    }
    if (files.length === 0) {
      return NextResponse.json({ success: false, error: '올릴 사진이 없습니다.' }, { status: 400 });
    }
    if (files.length > SELLER_INQUIRY_MAX_PHOTOS) {
      return NextResponse.json({ success: false, error: `사진은 한 번에 ${SELLER_INQUIRY_MAX_PHOTOS}장까지 올릴 수 있습니다.` }, { status: 400 });
    }
    for (const f of files) {
      if (!ALLOWED_TYPES.has(f.type)) {
        return NextResponse.json({ success: false, error: `지원하지 않는 이미지 형식입니다 (${f.type || f.name}).` }, { status: 400 });
      }
      if (f.size > MAX_BYTES) {
        return NextResponse.json({ success: false, error: `사진이 너무 큽니다 (${Math.round(f.size / 1024 / 1024)}MB, 최대 5MB).` }, { status: 400 });
      }
    }

    const { data: inquiry, error: qErr } = await supabase.from(T.main).select('id, status').eq('id', inquiryId).maybeSingle();
    if (qErr) throw qErr;
    if (!inquiry) return NextResponse.json({ success: false, error: '접수를 찾을 수 없습니다.' }, { status: 404 });
    if (inquiry.status === '처리완료') {
      return NextResponse.json({ success: false, error: '처리완료된 접수에는 사진을 붙일 수 없습니다.' }, { status: 409 });
    }

    // ── 업로드 ──
    const ts = Date.now();
    const rows: Omit<SellerInquiryPhotoRow, 'id' | 'created_at'>[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${inquiryId}/${ts}-${i + 1}.${ext}`;
      const buffer = Buffer.from(await f.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from(SELLER_INQUIRY_BUCKET)
        .upload(path, buffer, { contentType: f.type, upsert: false });
      if (upErr) throw new Error(`사진 업로드 실패: ${upErr.message}`);
      uploadedPaths.push(path);
      rows.push({
        inquiry_id: inquiryId,
        storage_path: path,
        public_url: supabase.storage.from(SELLER_INQUIRY_BUCKET).getPublicUrl(path).data.publicUrl,
        taken_by: takenBy,
      });
    }

    const { data: inserted, error: insErr } = await supabase.from(T.photos).insert(rows).select('*');
    if (insErr) throw insErr;

    return NextResponse.json({ success: true, photos: (inserted ?? []) as SellerInquiryPhotoRow[] });
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from(SELLER_INQUIRY_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    console.error('seller-inquiries photos POST 오류:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '사진 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
