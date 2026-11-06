import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { badgesForOrders, lookupOrderXlsx } from '../../../../lib/orderXlsxLookup';
import {
  SELLER_INQUIRY_DEFAULT_KIND,
  SELLER_INQUIRY_KINDS,
  SELLER_INQUIRY_LIST_PHOTOS,
  SELLER_INQUIRY_PAGE_SIZE,
  SELLER_INQUIRY_STATUSES,
  SELLER_INQUIRY_TABLES as T,
  isSellerInquiryKind,
  isSellerInquiryStatus,
  type SellerInquiryCounts,
  type SellerInquiryItemInput,
  type SellerInquiryItemRow,
  type SellerInquiryKind,
  type SellerInquiryListRow,
  type SellerInquiryPhotoRow,
  type SellerInquiryRow,
  type SellerInquiryStatus,
} from '../../../../lib/sellerInquiries';
import { appendMemoLine } from '../../../../lib/memoLog';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/seller-inquiries — 1688 판매자 문의 (미입고 접수 · 확인요청)
//
//   GET  : 창고 목록 (구분·상태·사용자·검색어 필터, 서버 페이지네이션) + 부족 행 집계
//          + 1688 계정 배지 + 사진 썸네일 + 탭 건수
//   POST : 상품입고 [미입고] · [1688 판매자 확인] 모달 접수 (kind)
//          미입고   — 같은 사용자·같은 배송번호에 처리완료가 아닌 미입고 접수가 있으면
//                     새로 만들지 않고 그 접수의 부족 행을 이번 스냅샷으로 바꾼다 (중복 접수 방지)
//          확인요청 — 요청 1번 = 접수 1건. 기존 접수를 바꾸지 않는다
//          메모는 줄 기록 (lib/memoLog) — 새 접수면 도장 1줄로 저장, 미입고 재접수면 기존 메모
//          맨 아래에 도장 1줄을 덧붙인다 (덮어쓰지 않는다)
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
// 목록·건수 공통 범위 (사용자 · 검색어)
// ============================================================
interface ListScope {
  userId: string | null;
  q: string;
  /** 글번호 검색으로 찾은 접수 id (q 가 있을 때만) */
  idsByItemNo: string[];
}

/** PostgREST 필터 빌더 중 범위 필터에 쓰는 메서드만 */
interface ScopeFilterable<Q> {
  eq(column: string, value: string): Q;
  or(filters: string): Q;
  ilike(column: string, pattern: string): Q;
}

function applyScope<Q extends ScopeFilterable<Q>>(query: Q, scope: ListScope): Q {
  let out = query;
  if (scope.userId) out = out.eq('user_id', scope.userId);
  if (scope.q) {
    const idList = scope.idsByItemNo.map((id) => `"${id}"`).join(',');
    out = idList
      ? out.or(`delivery_code.ilike.%${scope.q}%,id.in.(${idList})`)
      : out.ilike('delivery_code', `%${scope.q}%`);
  }
  return out;
}

const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

// ============================================================
// GET — 목록
//   ?kind=미입고|확인요청 &status=접수|문의중|처리완료 (없으면 전체) &user_id= &q= (배송번호·글번호) &page=
//   counts.status : 상태별 건수 — 구분 필터·사용자·검색어 반영 (상태 필터는 무시)
//   counts.kind   : 구분별 건수 — 상태 필터·사용자·검색어 반영 (구분 필터는 무시)
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const status = str(sp.get('status'));
    if (status && !isSellerInquiryStatus(status)) {
      return NextResponse.json({ success: false, error: 'status 값이 올바르지 않습니다.' }, { status: 400 });
    }
    // 구분은 모르는 값이면 무시한다 (전체)
    const kindRaw = str(sp.get('kind'));
    const kind: SellerInquiryKind | null = isSellerInquiryKind(kindRaw) ? kindRaw : null;
    const userId = str(sp.get('user_id'));
    if (userId && !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'user_id 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const q = (sp.get('q') ?? '').trim().replace(/[,()\\]/g, '').slice(0, 60);
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
    const from = (page - 1) * SELLER_INQUIRY_PAGE_SIZE;

    // ── 글번호 검색은 부족 행 테이블에서 inquiry_id 를 먼저 찾는다 ──
    let idsByItemNo: string[] = [];
    if (q) {
      const hit = await fetchAllRows<{ inquiry_id: string }>((a, b) =>
        supabase.from(T.items).select('inquiry_id').ilike('item_no', `%${q}%`).order('id', { ascending: true }).range(a, b)
      );
      idsByItemNo = Array.from(new Set(hit.map((h) => h.inquiry_id)));
    }
    const scope: ListScope = { userId, q, idsByItemNo };

    // ── 목록 (이 페이지) ──
    let query = applyScope(
      supabase
        .from(T.main)
        .select('*', { count: 'exact' })
        .order('received_at', { ascending: false })
        .range(from, from + SELLER_INQUIRY_PAGE_SIZE - 1),
      scope
    );
    if (status) query = query.eq('status', status);
    if (kind) query = query.eq('kind', kind);
    const listRes = await query;
    if (listRes.error) throw listRes.error;
    const rows = (listRes.data ?? []) as SellerInquiryRow[];
    const ids = rows.map((r) => r.id);

    // ── 부족 행 집계 + 1688 주문ID + 사진 (이 페이지의 접수만) ──
    type ItemAgg = Pick<
      SellerInquiryListRow,
      'item_count' | 'first_item_no' | 'first_img_url' | 'expected_total' | 'arrived_total' | 'short_total'
    > & { orderIds: Set<string> };
    const emptyAgg = (): ItemAgg => ({
      item_count: 0, first_item_no: null, first_img_url: null, expected_total: 0, arrived_total: 0, short_total: 0,
      orderIds: new Set<string>(),
    });
    const agg = new Map<string, ItemAgg>();
    const photoAgg = new Map<string, { count: number; urls: string[] }>();
    if (ids.length > 0) {
      const [items, photos] = await Promise.all([
        fetchAllRows<Pick<SellerInquiryItemRow, 'inquiry_id' | 'item_no' | 'img_url' | 'order_id_1688' | 'expected_qty' | 'arrived_qty' | 'short_qty'>>((a, b) =>
          supabase
            .from(T.items)
            .select('inquiry_id, item_no, img_url, order_id_1688, expected_qty, arrived_qty, short_qty')
            .in('inquiry_id', ids)
            .order('item_no', { ascending: true })
            .order('id', { ascending: true })
            .range(a, b)
        ),
        fetchAllRows<Pick<SellerInquiryPhotoRow, 'inquiry_id' | 'public_url'>>((a, b) =>
          supabase
            .from(T.photos)
            .select('inquiry_id, public_url')
            .in('inquiry_id', ids)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(a, b)
        ),
      ]);
      for (const it of items) {
        const cur = agg.get(it.inquiry_id) ?? emptyAgg();
        cur.item_count += 1;
        if (cur.first_item_no === null) {
          cur.first_item_no = it.item_no;
          cur.first_img_url = it.img_url;
        }
        cur.expected_total += it.expected_qty;
        cur.arrived_total += it.arrived_qty;
        cur.short_total += it.short_qty;
        const orderId = it.order_id_1688?.trim();
        if (orderId) cur.orderIds.add(orderId);
        agg.set(it.inquiry_id, cur);
      }
      for (const p of photos) {
        const cur = photoAgg.get(p.inquiry_id) ?? { count: 0, urls: [] };
        cur.count += 1;
        if (cur.urls.length < SELLER_INQUIRY_LIST_PHOTOS) cur.urls.push(p.public_url);
        photoAgg.set(p.inquiry_id, cur);
      }
    }

    // ── 1688 계정 배지 — 이 페이지의 주문ID 전부를 한 번에 조회 ──
    const pageOrderIds = Array.from(agg.values()).flatMap((a) => Array.from(a.orderIds));
    const xlsxInfo = await lookupOrderXlsx(pageOrderIds);

    const list: SellerInquiryListRow[] = rows.map((r) => {
      const { orderIds, ...itemAgg } = agg.get(r.id) ?? emptyAgg();
      const orderIdList = Array.from(orderIds);
      const photo = photoAgg.get(r.id);
      return {
        ...r,
        ...itemAgg,
        photo_count: photo?.count ?? 0,
        photo_urls: photo?.urls ?? [],
        order_ids_1688: orderIdList,
        account_badges: badgesForOrders(orderIdList, xlsxInfo),
      };
    });

    // ── 탭 건수 — 사용자·검색어 범위의 (kind, status) 를 한 번 훑어 JS 로 집계 ──
    const scopeRows = await fetchAllRows<{ kind: string; status: string }>((a, b) =>
      applyScope(
        supabase
          .from(T.main)
          .select('kind, status')
          .order('received_at', { ascending: false })
          .order('id', { ascending: true })
          .range(a, b),
        scope
      )
    );
    const statusCounts = zeroCounts<SellerInquiryStatus>(SELLER_INQUIRY_STATUSES);
    const kindCounts = zeroCounts<SellerInquiryKind>(SELLER_INQUIRY_KINDS);
    const counts: SellerInquiryCounts = { status: statusCounts, kind: kindCounts };
    for (const r of scopeRows) {
      if (isSellerInquiryStatus(r.status) && (!kind || r.kind === kind)) statusCounts[r.status] += 1;
      if (isSellerInquiryKind(r.kind) && (!status || r.status === status)) kindCounts[r.kind] += 1;
    }

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
//   body: { kind?, user_id, created_by?, delivery_code, memo?, items: SellerInquiryItemInput[] }
//     kind 없음 → '미입고' (SELLER_INQUIRY_DEFAULT_KIND)
//   검증 (expected_qty 의 뜻이 구분별로 다르다 — 확인수량):
//     미입고   — expected = 입고되어야 할 수량(order−cancel), short = expected − arrived 이고 short > 0
//     확인요청 — expected = 작업자가 입력한 확인수량 (1 이상 정수), arrived = 실제 입고 수량 (0 이상),
//                short = 0 (부족 계산 대상이 아니다) · memo 필수
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
    const kindRaw: unknown = body?.kind ?? SELLER_INQUIRY_DEFAULT_KIND;

    if (!isSellerInquiryKind(kindRaw)) {
      return NextResponse.json({ success: false, error: 'kind 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const kind: SellerInquiryKind = kindRaw;
    const isMissing = kind === '미입고';

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: '사용자를 선택해주세요.' }, { status: 400 });
    }
    if (!deliveryCode) {
      return NextResponse.json({ success: false, error: '배송번호가 없습니다.' }, { status: 400 });
    }
    if (rawItems.length === 0) {
      return NextResponse.json(
        { success: false, error: isMissing ? '부족한 주문이 없습니다.' : '선택한 주문이 없습니다.' },
        { status: 400 }
      );
    }
    if (!isMissing && !memo) {
      return NextResponse.json({ success: false, error: '확인 요청 내용을 입력해주세요.' }, { status: 400 });
    }

    // ── 주문행 검증 — 수량은 0 이상 정수, 부족 수량 공식은 구분별 (위 주석) ──
    const items: SellerInquiryItemInput[] = [];
    for (const raw of rawItems as Record<string, unknown>[]) {
      const orderItemId = str(raw.order_item_id);
      const expected = nonNegInt(raw.expected_qty);
      const arrived = nonNegInt(raw.arrived_qty);
      const short = nonNegInt(raw.short_qty);
      if (!orderItemId || !UUID_RE.test(orderItemId) || expected === null || arrived === null || short === null) {
        return NextResponse.json({ success: false, error: '주문행 데이터가 올바르지 않습니다.' }, { status: 400 });
      }
      if (isMissing && !(short === expected - arrived && short > 0)) {
        return NextResponse.json(
          { success: false, error: `부족 수량이 맞지 않습니다 (${raw.item_no ?? orderItemId}: ${expected} − ${arrived} ≠ ${short}).` },
          { status: 400 }
        );
      }
      if (!isMissing && !(expected >= 1 && short === 0)) {
        return NextResponse.json(
          { success: false, error: `확인수량이 올바르지 않습니다 (${raw.item_no ?? orderItemId}: 확인수량 ${expected}, 부족 ${short}).` },
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

    // ── 미입고: 열린 접수(처리완료 아님)가 있으면 그 접수를 갱신 · 확인요청: 항상 새 접수 ──
    let open: { id: string; memo: string | null } | null = null;
    if (isMissing) {
      const { data, error: openErr } = await supabase
        .from(T.main)
        .select('id, memo')
        .eq('user_id', userId)
        .eq('delivery_code', deliveryCode)
        .eq('kind', kind)
        .neq('status', '처리완료')
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (openErr) throw openErr;
      open = data;
    }

    const now = new Date();
    let inquiryId: string;
    let created = false;
    if (open) {
      inquiryId = open.id;
      const { error: delErr } = await supabase.from(T.items).delete().eq('inquiry_id', inquiryId);
      if (delErr) throw delErr;
      const patch: Record<string, unknown> = { created_by: createdBy };
      // 메모는 덮어쓰지 않고 기존 기록 맨 아래에 1줄 덧붙인다
      if (memo !== null) patch.memo = appendMemoLine(open.memo, memo, now);
      const { error: updErr } = await supabase.from(T.main).update(patch).eq('id', inquiryId);
      if (updErr) throw updErr;
    } else {
      const { data: ins, error: insErr } = await supabase
        .from(T.main)
        .insert({
          user_id: userId,
          team_code: user.user_code ?? '',
          delivery_code: deliveryCode,
          kind,
          status: '접수',
          memo: memo === null ? null : appendMemoLine(null, memo, now),
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
      // 새로 만든 접수인데 주문행 저장에 실패하면 빈 접수를 남기지 않는다
      if (created) await supabase.from(T.main).delete().eq('id', inquiryId);
      throw itemsErr;
    }

    return NextResponse.json({ success: true, id: inquiryId, created, item_count: items.length });
  } catch (error) {
    console.error('seller-inquiries POST 오류:', error);
    return NextResponse.json(
      { success: false, error: '판매자 문의 접수 중 오류가 발생했습니다.', details: (error as Error)?.message },
      { status: 500 }
    );
  }
}
