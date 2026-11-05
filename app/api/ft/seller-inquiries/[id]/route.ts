import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import {
  SELLER_INQUIRY_TABLES as T,
  SELLER_INQUIRY_TRANSITIONS,
  isSellerInquiryStatus,
  type SellerInquiryDetail,
  type SellerInquiryItemRow,
  type SellerInquiryPhotoRow,
  type SellerInquiryRow,
} from '../../../../../lib/sellerInquiries';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/seller-inquiries/[id]
//   GET   : 상세 (접수 + 부족 행 + 사진)
//   PATCH : 상태 전이 · 메모
//           status 는 SELLER_INQUIRY_TRANSITIONS 의 허용 전이만, 조건부 UPDATE 로 동시 변경을 막는다
//           전이 시각: 문의중 → inquiring_at, 처리완료 → completed_at (되돌리면 completed_at 비움)
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadDetail(id: string): Promise<SellerInquiryDetail | null> {
  const { data: main, error } = await supabase.from(T.main).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!main) return null;
  const [items, photos] = await Promise.all([
    supabase.from(T.items).select('*').eq('inquiry_id', id).order('item_no', { ascending: true }).range(0, 999),
    supabase.from(T.photos).select('*').eq('inquiry_id', id).order('created_at', { ascending: true }).range(0, 999),
  ]);
  if (items.error) throw items.error;
  if (photos.error) throw photos.error;
  return {
    ...(main as SellerInquiryRow),
    items: (items.data ?? []) as SellerInquiryItemRow[],
    photos: (photos.data ?? []) as SellerInquiryPhotoRow[],
  };
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ success: false, error: 'id 가 올바르지 않습니다.' }, { status: 400 });
    }
    const detail = await loadDetail(params.id);
    if (!detail) return NextResponse.json({ success: false, error: '접수를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ success: true, inquiry: detail });
  } catch (error) {
    console.error('seller-inquiries [id] GET 오류:', error);
    return NextResponse.json({ success: false, error: '상세를 불러오는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json({ success: false, error: 'id 가 올바르지 않습니다.' }, { status: 400 });
    }
    const body = await request.json();
    const hasStatus = body?.status !== undefined;
    const hasMemo = body?.memo !== undefined;
    if (!hasStatus && !hasMemo) {
      return NextResponse.json({ success: false, error: '바꿀 내용이 없습니다.' }, { status: 400 });
    }

    // ── 메모 ──
    if (hasMemo) {
      const memo = body.memo == null ? null : String(body.memo).trim() || null;
      const { error } = await supabase.from(T.main).update({ memo }).eq('id', params.id);
      if (error) throw error;
    }

    // ── 상태 전이 ──
    if (hasStatus) {
      const next = body.status;
      if (!isSellerInquiryStatus(next)) {
        return NextResponse.json({ success: false, error: 'status 값이 올바르지 않습니다.' }, { status: 400 });
      }
      const { data: cur, error: curErr } = await supabase.from(T.main).select('status').eq('id', params.id).maybeSingle();
      if (curErr) throw curErr;
      if (!cur) return NextResponse.json({ success: false, error: '접수를 찾을 수 없습니다.' }, { status: 404 });
      if (!isSellerInquiryStatus(cur.status) || !SELLER_INQUIRY_TRANSITIONS[cur.status].includes(next)) {
        return NextResponse.json(
          { success: false, error: `${cur.status} 에서 ${next} 로 바꿀 수 없습니다.` },
          { status: 409 }
        );
      }
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status: next };
      if (next === '문의중') { patch.inquiring_at = now; patch.completed_at = null; }
      if (next === '처리완료') patch.completed_at = now;
      // 조건부 UPDATE — 그 사이 다른 PC 가 먼저 바꿨으면 0행
      const { data: upd, error: updErr } = await supabase
        .from(T.main)
        .update(patch)
        .eq('id', params.id)
        .eq('status', cur.status)
        .select('id');
      if (updErr) throw updErr;
      if (!upd || upd.length === 0) {
        return NextResponse.json({ success: false, error: '다른 작업자가 먼저 상태를 바꿨습니다. 새로고침 후 다시 시도하세요.' }, { status: 409 });
      }
    }

    const detail = await loadDetail(params.id);
    return NextResponse.json({ success: true, inquiry: detail });
  } catch (error) {
    console.error('seller-inquiries [id] PATCH 오류:', error);
    return NextResponse.json({ success: false, error: '저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
