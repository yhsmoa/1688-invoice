import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import {
  SELLER_INQUIRY_PAGE_SIZE,
  SELLER_INQUIRY_TABLES as T,
  isSellerInquiryStatus,
  type SellerInquiryItemInput,
  type SellerInquiryItemRow,
  type SellerInquiryListRow,
  type SellerInquiryRow,
} from '../../../../lib/sellerInquiries';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/seller-inquiries — 1688 판매자 문의 (미입고 접수)
//
//   GET  : 창고 목록 (상태·사용자·검색어 필터, 서버 페이지네이션) + 부족 행 집계
//   POST : 상품입고 [미입고] 모달 접수
//          같은 사용자·같은 배송번호에 처리완료가 아닌 접수가 있으면 새로 만들지 않고
//          그 접수의 부족 행을 이번 스냅샷으로 바꾼다 (중복 접수 방지)
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_PAGE = 1000;

/** 전체 행 순회 — PostgREST 1000행 제한 대응 (lib/confirmDone.ts fetchAll 과 같은 루프) */
async function fetchAllRows<R>(
  build: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>
): Promise<R[]> {
  const all: R[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build(from, from + SUPABASE_PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < SUPABASE_PAGE) break;
    from += SUPABASE_PAGE;
  }
  return all;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const nonNegInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// ============================================================
// GET — 목록
//   ?status=접수|문의중|처리완료 (없으면 전체) &user_id= &q= (배송번호·글번호) &page=
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const status = str(sp.get('status'));
    if (status && !isSellerInquiryStatus(status)) {
      return NextResponse.json({ success: false, error: 'status 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const userId = str(sp.get('user_id'));
    if (userId && !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'user_id 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const q = (sp.get('q') ?? '').trim().replace(/[,()\\]/g, '').slice(0, 60);
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
    const from = (page - 1) * SELLER_INQUIRY_PAGE_SIZE;

    // 글번호 검색은 부족 행 테이블에서 inquiry_id 를 먼저 찾는다
    let idsByItemNo: string[] | null = null;
    if (q) {
      const hit = await fetchAllRows<{ inquiry_id: string }>((a, b) =>
        supabase.from(T.items).select('inquiry_id').ilike('item_no', `%${q}%`).range(a, b)
      );
      idsByItemNo = Array.from(new Set(hit.map((h) => h.inquiry_id)));
    }

    let query = supabase
      .from(T.main)
      .select('*', { count: 'exact' })
      .order('received_at', { ascending: false })
      .range(from, from + SELLER_INQUIRY_PAGE_SIZE - 1);
    if (status) query = query.eq('status', status);
    if (userId) query = query.eq('user_id', userId);
    if (q) {
      const idList = (idsByItemNo ?? []).map((id) => `"${id}"`).join(',');
      query = idList
        ? query.or(`delivery_code.ilike.%${q}%,id.in.(${idList})`)
        : query.ilike('delivery_code', `%${q}%`);
    }
    const listRes = await query;
    if (listRes.error) throw listRes.error;
    const rows = (listRes.data ?? []) as SellerInquiryRow[];
    const ids = rows.map((r) => r.id);

    // ── 부족 행 집계 + 사진 수 (이 페이지의 접수만) ──
    const agg = new Map<string, Pick<SellerInquiryListRow, 'item_count' | 'first_item_no' | 'first_img_url' | 'expected_total' | 'arrived_total' | 'short_total'>>();
    const photoCount = new Map<string, number>();
    if (ids.length > 0) {
      const [items, photos] = await Promise.all([
        fetchAllRows<Pick<SellerInquiryItemRow, 'inquiry_id' | 'item_no' | 'img_url' | 'expected_qty' | 'arrived_qty' | 'short_qty' | 'created_at'>>((a, b) =>
          supabase
            .from(T.items)
            .select('inquiry_id, item_no, img_url, expected_qty, arrived_qty, short_qty, created_at')
            .in('inquiry_id', ids)
            .order('item_no', { ascending: true })
            .range(a, b)
        ),
        fetchAllRows<{ inquiry_id: string }>((a, b) =>
          supabase.from(T.photos).select('inquiry_id').in('inquiry_id', ids).range(a, b)
        ),
      ]);
      for (const it of items) {
        const cur = agg.get(it.inquiry_id) ?? {
          item_count: 0, first_item_no: null, first_img_url: null, expected_total: 0, arrived_total: 0, short_total: 0,
        };
        cur.item_count += 1;
        if (cur.first_item_no === null) {
          cur.first_item_no = it.item_no;
          cur.first_img_url = it.img_url;
        }
        cur.expected_total += it.expected_qty;
        cur.arrived_total += it.arrived_qty;
        cur.short_total += it.short_qty;
        agg.set(it.inquiry_id, cur);
      }
      for (const p of photos) photoCount.set(p.inquiry_id, (photoCount.get(p.inquiry_id) ?? 0) + 1);
    }

    const list: SellerInquiryListRow[] = rows.map((r) => ({
      ...r,
      ...(agg.get(r.id) ?? { item_count: 0, first_item_no: null, first_img_url: null, expected_total: 0, arrived_total: 0, short_total: 0 }),
      photo_count: photoCount.get(r.id) ?? 0,
    }));

    // ── 상태별 건수 (필터 무관) ──
    const statusRows = await fetchAllRows<{ status: string }>((a, b) =>
      supabase.from(T.main).select('status').range(a, b)
    );
    const counts: Record<string, number> = { 접수: 0, 문의중: 0, 처리완료: 0 };
    for (const s of statusRows) counts[s.status] = (counts[s.status] ?? 0) + 1;

    return NextResponse.json({
      success: true,
      rows: list,
      total: listRes.count ?? list.length,
      page,
      pageSize: SELLER_INQUIRY_PAGE_SIZE,
      counts,
    });
  } catch (error) {
    console.error('seller-inquiries GET 오류:', error);
    return NextResponse.json(
      { success: false, error: '판매자 문의 목록을 불러오는 중 오류가 발생했습니다.', details: (error as Error)?.message },
      { status: 500 }
    );
  }
}

// ============================================================
// POST — 접수
//   body: { user_id, created_by?, delivery_code, memo?, items: SellerInquiryItemInput[] }
//   응답: { success, id, created: true(새 접수) | false(기존 접수 갱신), item_count }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = str(body?.user_id);
    const deliveryCode = str(body?.delivery_code);
    const createdBy = str(body?.created_by);
    const memo = str(body?.memo);
    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: '사용자를 선택해주세요.' }, { status: 400 });
    }
    if (!deliveryCode) {
      return NextResponse.json({ success: false, error: '배송번호가 없습니다.' }, { status: 400 });
    }
    if (rawItems.length === 0) {
      return NextResponse.json({ success: false, error: '부족한 주문이 없습니다.' }, { status: 400 });
    }

    // ── 부족 행 검증 — 수량은 0 이상 정수, short = expected − arrived 가 맞아야 한다 ──
    const items: SellerInquiryItemInput[] = [];
    for (const raw of rawItems as Record<string, unknown>[]) {
      const orderItemId = str(raw.order_item_id);
      const expected = nonNegInt(raw.expected_qty);
      const arrived = nonNegInt(raw.arrived_qty);
      const short = nonNegInt(raw.short_qty);
      if (!orderItemId || !UUID_RE.test(orderItemId) || expected === null || arrived === null || short === null) {
        return NextResponse.json({ success: false, error: '부족 행 데이터가 올바르지 않습니다.' }, { status: 400 });
      }
      if (short !== expected - arrived || short <= 0) {
        return NextResponse.json(
          { success: false, error: `부족 수량이 맞지 않습니다 (${raw.item_no ?? orderItemId}: ${expected} − ${arrived} ≠ ${short}).` },
          { status: 400 }
        );
      }
      items.push({
        order_item_id: orderItemId,
        order_no: str(raw.order_no),
        item_no: str(raw.item_no),
        product_no: str(raw.product_no),
        item_name: str(raw.item_name),
        option_name: str(raw.option_name),
        china_option1: str(raw.china_option1),
        china_option2: str(raw.china_option2),
        img_url: str(raw.img_url),
        site_url: str(raw.site_url),
        order_id_1688: str(raw.order_id_1688),
        expected_qty: expected,
        arrived_qty: arrived,
        short_qty: short,
      });
    }

    // ── 사용자 → team_code ──
    const { data: user, error: userErr } = await supabase
      .from('ft_users')
      .select('id, user_code')
      .eq('id', userId)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) {
      return NextResponse.json({ success: false, error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // ── 열린 접수(처리완료 아님)가 있으면 그 접수를 갱신 ──
    const { data: open, error: openErr } = await supabase
      .from(T.main)
      .select('id')
      .eq('user_id', userId)
      .eq('delivery_code', deliveryCode)
      .neq('status', '처리완료')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openErr) throw openErr;

    let inquiryId: string;
    let created = false;
    if (open) {
      inquiryId = open.id;
      const { error: delErr } = await supabase.from(T.items).delete().eq('inquiry_id', inquiryId);
      if (delErr) throw delErr;
      const patch: Record<string, unknown> = { created_by: createdBy };
      if (memo !== null) patch.memo = memo;
      const { error: updErr } = await supabase.from(T.main).update(patch).eq('id', inquiryId);
      if (updErr) throw updErr;
    } else {
      const { data: ins, error: insErr } = await supabase
        .from(T.main)
        .insert({
          user_id: userId,
          team_code: user.user_code ?? '',
          delivery_code: deliveryCode,
          status: '접수',
          memo,
          created_by: createdBy,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      inquiryId = ins.id;
      created = true;
    }

    const { error: itemsErr } = await supabase
      .from(T.items)
      .insert(items.map((it) => ({ ...it, inquiry_id: inquiryId })));
    if (itemsErr) {
      // 새로 만든 접수인데 부족 행 저장에 실패하면 빈 접수를 남기지 않는다
      if (created) await supabase.from(T.main).delete().eq('id', inquiryId);
      throw itemsErr;
    }

    return NextResponse.json({ success: true, id: inquiryId, created, item_count: items.length });
  } catch (error) {
    console.error('seller-inquiries POST 오류:', error);
    return NextResponse.json(
      { success: false, error: '미입고 접수 중 오류가 발생했습니다.', details: (error as Error)?.message },
      { status: 500 }
    );
  }
}
