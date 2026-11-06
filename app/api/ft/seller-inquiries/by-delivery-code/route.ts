import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import {
  SELLER_INQUIRY_DEFAULT_KIND,
  SELLER_INQUIRY_TABLES as T,
  isSellerInquiryKind,
  type SellerInquiryDetail,
  type SellerInquiryItemRow,
  type SellerInquiryPhotoRow,
  type SellerInquiryRow,
} from '../../../../../lib/sellerInquiries';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/seller-inquiries/by-delivery-code?delivery_code=… &kind=미입고|확인요청
//
//   모바일 [촬영] 으로 읽은 1688 운송장 번호로 접수를 찾는다.
//   처리완료가 아닌 접수 중 가장 최근 것 하나 — 없으면 404 (사진을 붙일 접수가 없다는 뜻).
//   같은 번호의 열린 접수가 사용자별로 여럿이면 가장 최근 것을 쓰고 others 로 나머지를 알려 준다.
//   kind 없음 → 미입고 (모바일 [촬영] 은 kind 를 보내지 않는다 — 미입고 접수에만 사진을 붙인다)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const code = (request.nextUrl.searchParams.get('delivery_code') ?? '').trim();
    if (!code) {
      return NextResponse.json({ success: false, error: '배송번호가 없습니다.' }, { status: 400 });
    }
    const kind = request.nextUrl.searchParams.get('kind') ?? SELLER_INQUIRY_DEFAULT_KIND;
    if (!isSellerInquiryKind(kind)) {
      return NextResponse.json({ success: false, error: 'kind 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const { data: list, error } = await supabase
      .from(T.main)
      .select('*')
      .eq('delivery_code', code)
      .eq('kind', kind)
      .neq('status', '처리완료')
      .order('received_at', { ascending: false })
      .range(0, 9);
    if (error) throw error;
    if (!list || list.length === 0) {
      return NextResponse.json({ success: false, error: '이 배송번호로 접수된 미입고 건이 없습니다.' }, { status: 404 });
    }
    const main = list[0] as SellerInquiryRow;
    const [items, photos] = await Promise.all([
      supabase.from(T.items).select('*').eq('inquiry_id', main.id).order('item_no', { ascending: true }).range(0, 999),
      supabase.from(T.photos).select('*').eq('inquiry_id', main.id).order('created_at', { ascending: true }).range(0, 999),
    ]);
    if (items.error) throw items.error;
    if (photos.error) throw photos.error;
    const inquiry: SellerInquiryDetail = {
      ...main,
      items: (items.data ?? []) as SellerInquiryItemRow[],
      photos: (photos.data ?? []) as SellerInquiryPhotoRow[],
    };
    return NextResponse.json({
      success: true,
      inquiry,
      others: (list as SellerInquiryRow[]).slice(1).map((r) => ({ id: r.id, team_code: r.team_code, status: r.status })),
    });
  } catch (error) {
    console.error('seller-inquiries by-delivery-code 오류:', error);
    return NextResponse.json({ success: false, error: '접수를 찾는 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
