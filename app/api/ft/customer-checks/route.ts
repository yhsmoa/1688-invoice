import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabase } from '../../../../lib/supabase';
import {
  CUSTOMER_CONFIRM_MAX_ATTACHMENTS,
  customerConfirmFileField,
} from '../../../../lib/customerConfirm';
import {
  CHECK_PAGE_SIZE,
  CHECK_SIZE_CODES,
  CHECK_TAB_STATUS,
  CHECK_TABS,
  isCheckTab,
  type CheckTab,
  type CustomerCheckCounts,
  type CustomerCheckListRow,
  type CheckAuthorRole,
  type CustomerCheckRow,
} from '../../../../lib/customerChecks';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/customer-checks — 고객 검수 확인요청 (Notion 상품확인 DB 대체)
//
//   POST : 입고 V2/V3 [고객확인] 모달 저장 (multipart)
//   GET  : 창고 화면 목록 + 건수 (서버 페이지네이션)
//
//   스키마: supabase/inspection/001_customer_checks.sql
//   이미지: Supabase Storage 공개 버킷 customer-confirm — 경로 {check_id}/{ts}-{n}.{ext}
// ============================================================

const STORAGE_BUCKET = 'customer-confirm';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPABASE_PAGE = 1000;   // PostgREST 기본 응답 제한

// ============================================================
// 공용 — 전체 행 순회 (1000행 제한 대응, lib/confirmDone.ts fetchAll 과 같은 루프)
// ============================================================
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
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

// ============================================================
// POST — 모달 저장
//
// 요청: multipart/form-data
//   - user_id      : ft_users.id (선택 사업자)        필수
//   - requested_by : 요청 작업자 이름 (Worker)         선택
//   - memo         : 요청 메모 → 모든 항목의 첫 댓글   선택
//   - payload      : JSON 배열 (아래 ItemPayload)
//   - file_<id>    : 항목별 첨부 이미지 × 0~N (같은 필드명 여러 개, 첨부 순서)
//
// 처리 (항목별, 한 항목 실패는 그 항목만 실패로 집계):
//   1. 검증 (장수·확인수량·사이즈코드)
//   2. check_id 를 먼저 발급 → 이미지 업로드 ({check_id}/…)
//   3. ft_customer_checks 행 → 이미지 행 → 메모 댓글
//   실패 시 이미 올라간 파일·만들어진 행을 정리한다 (불완전한 요청을 남기지 않음)
// ============================================================
interface ItemPayload {
  id: string;                   // ft_order_items.id
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  order_no: string | null;
  product_no?: string | null;
  order_qty: number | null;
  confirm_qty: string | null;   // 확인수량 (문자열 입력, 0 허용)
  arrival_qty: number | null;
  img_url: string | null;
  site_url: string | null;
  size_code: string | null;
  attributes: string[];
  file_count?: number;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const int = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

async function uploadImage(checkId: string, file: File, batchTs: number, index: number): Promise<{ path: string; url: string }> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${checkId}/${batchTs}-${index + 1}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(`이미지 업로드 실패: ${error.message}`);
  return { path, url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const userId = str(formData.get('user_id'));
    const requestedBy = str(formData.get('requested_by'));
    const memo = str(formData.get('memo'));
    const payloadRaw = formData.get('payload');

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: '선택된 사업자(user_id)가 없습니다.' }, { status: 400 });
    }
    if (!payloadRaw || typeof payloadRaw !== 'string') {
      return NextResponse.json({ success: false, error: 'payload 가 필요합니다.' }, { status: 400 });
    }

    let items: ItemPayload[];
    try {
      items = JSON.parse(payloadRaw);
    } catch {
      return NextResponse.json({ success: false, error: 'payload 파싱에 실패했습니다.' }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: '전송할 항목이 없습니다.' }, { status: 400 });
    }

    // ── 사업자 확인 → team_code 스냅샷 ──
    const { data: user, error: userErr } = await supabase
      .from('ft_users')
      .select('id, user_code')
      .eq('id', userId)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) {
      return NextResponse.json({ success: false, error: '사업자를 찾을 수 없습니다.' }, { status: 400 });
    }
    const teamCode = str(user.user_code);
    if (!teamCode) {
      return NextResponse.json({ success: false, error: '선택된 사업자의 USER_CODE 가 없어 저장할 수 없습니다.' }, { status: 400 });
    }

    let created = 0;
    const failed: { item_no: string; error: string }[] = [];

    for (const item of items) {
      const uploaded: string[] = [];
      let checkId: string | null = null;
      try {
        // ── 1. 검증 ──
        const files = formData
          .getAll(customerConfirmFileField(item.id))
          .filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length > CUSTOMER_CONFIRM_MAX_ATTACHMENTS) {
          throw new Error(`첨부 이미지는 항목당 최대 ${CUSTOMER_CONFIRM_MAX_ATTACHMENTS}장입니다 (${files.length}장 수신)`);
        }
        const expected = typeof item.file_count === 'number' ? item.file_count : files.length;
        if (files.length !== expected) {
          throw new Error(`첨부 이미지 장수 불일치 (보냄 ${expected}장 / 받음 ${files.length}장) — 다시 저장해주세요`);
        }

        const confirmQty = int(item.confirm_qty);
        if (confirmQty === null || confirmQty < 0) {
          throw new Error('확인수량은 0 이상의 정수여야 합니다.');
        }
        const sizeCode = str(item.size_code);
        if (sizeCode && !(CHECK_SIZE_CODES as readonly string[]).includes(sizeCode)) {
          throw new Error(`사이즈 코드가 올바르지 않습니다: ${sizeCode}`);
        }
        const attributes = Array.isArray(item.attributes)
          ? item.attributes.map((a) => String(a).trim()).filter(Boolean)
          : [];

        // ── 2. id 발급 → 이미지 업로드 ──
        checkId = randomUUID();
        const batchTs = Date.now();
        const images: { path: string; url: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          const up = await uploadImage(checkId, files[i], batchTs, i);
          uploaded.push(up.path);
          images.push(up);
        }

        // ── 3. 요청 행 ──
        const { error: insErr } = await supabase.from('ft_customer_checks').insert({
          id: checkId,
          user_id: userId,
          team_code: teamCode,
          order_item_id: UUID_RE.test(item.id) ? item.id : null,
          order_no: str(item.order_no),
          item_no: str(item.item_no),
          product_no: str(item.product_no),
          item_name: str(item.item_name),
          option_name: str(item.option_name),
          china_option1: str(item.china_option1),
          china_option2: str(item.china_option2),
          img_url: str(item.img_url),
          site_url: str(item.site_url),
          size_code: sizeCode,
          order_qty: int(item.order_qty),
          confirm_qty: confirmQty,
          arrival_qty: int(item.arrival_qty) ?? 0,
          attributes,
          requested_by: requestedBy,
        });
        if (insErr) throw new Error(insErr.message);

        // ── 이미지 행 ──
        if (images.length > 0) {
          const { error: imgErr } = await supabase.from('ft_customer_check_images').insert(
            images.map((img, idx) => ({
              check_id: checkId,
              storage_path: img.path,
              public_url: img.url,
              sort_order: idx,
            }))
          );
          if (imgErr) throw new Error(imgErr.message);
        }

        // ── 요청 메모 → 첫 댓글 (창고) ──
        if (memo) {
          const { error: cmErr } = await supabase.from('ft_customer_check_comments').insert({
            check_id: checkId,
            author_role: 'warehouse',
            author_name: requestedBy,
            body: memo,
          });
          if (cmErr) throw new Error(cmErr.message);
        }

        created += 1;
      } catch (err) {
        console.error(`고객 검수 확인 저장 실패 (${item.item_no}):`, err);
        // ── 정리: 만들어진 행(댓글·이미지 행은 CASCADE) + 올라간 파일 ──
        if (checkId) {
          await supabase.from('ft_customer_checks').delete().eq('id', checkId);
        }
        if (uploaded.length > 0) {
          await supabase.storage.from(STORAGE_BUCKET).remove(uploaded);
        }
        failed.push({
          item_no: item.item_no || item.id,
          error: err instanceof Error ? err.message : '알 수 없는 오류',
        });
      }
    }

    return NextResponse.json({ success: true, created, failed });
  } catch (error) {
    console.error('customer-checks POST 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '고객 검수 확인 저장 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// 건수 — 탭(상태)별 전체 + 팀별
//
//   진행 중 상태(확인요청·재문의·답변완료)는 쌓이지 않고 처리되며 줄어드는 집합이라
//   user_id 만 range 루프로 모아 센다. 처리완료는 계속 늘어나므로 행을 가져오지 않고
//   팀별 head count 로 센다 (팀 = ft_users, 몇 개 수준).
// ============================================================
async function fetchCounts(): Promise<CustomerCheckCounts> {
  const counts = Object.fromEntries(
    CHECK_TABS.map((t) => [t, { total: 0, byUser: {} as Record<string, number> }])
  ) as CustomerCheckCounts;

  const activeTabs: CheckTab[] = ['open', 'reinquiry', 'answered'];
  const tabByStatus = new Map(activeTabs.map((t) => [CHECK_TAB_STATUS[t], t]));

  const [activeRows, usersRes, doneTotalRes] = await Promise.all([
    fetchAllRows<{ user_id: string; status: string }>((a, b) =>
      supabase
        .from('ft_customer_checks')
        .select('user_id, status')
        .in('status', activeTabs.map((t) => CHECK_TAB_STATUS[t]))
        .order('id', { ascending: true })
        .range(a, b)
    ),
    supabase.from('ft_users').select('id'),
    supabase.from('ft_customer_checks').select('id', { count: 'exact', head: true }).eq('status', CHECK_TAB_STATUS.done),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (doneTotalRes.error) throw doneTotalRes.error;

  activeRows.forEach((r) => {
    const tab = tabByStatus.get(r.status as CustomerCheckRow['status']);
    if (!tab) return;
    counts[tab].total += 1;
    counts[tab].byUser[r.user_id] = (counts[tab].byUser[r.user_id] ?? 0) + 1;
  });

  counts.done.total = doneTotalRes.count ?? 0;
  const userIds = (usersRes.data ?? []).map((u: { id: string }) => u.id);
  const perUser = await Promise.all(
    userIds.map((uid) =>
      supabase
        .from('ft_customer_checks')
        .select('id', { count: 'exact', head: true })
        .eq('status', CHECK_TAB_STATUS.done)
        .eq('user_id', uid)
    )
  );
  perUser.forEach((res, i) => {
    if (res.error) throw res.error;
    if ((res.count ?? 0) > 0) counts.done.byUser[userIds[i]] = res.count ?? 0;
  });

  return counts;
}

// ============================================================
// GET — 목록 + 건수
//
// Query:
//   tab     : open(확인요청) | reinquiry(재문의) | answered(답변완료) | done(처리완료)   (기본 open)
//   user_id : 팀 필터 (모든 탭)  선택
//   q       : 주문번호·아이템번호·상품명 검색 (부분 일치) 선택
//   page    : 1부터 (CHECK_PAGE_SIZE 건씩)
//
// 응답: { success, rows: CustomerCheckListRow[], total, page, pageSize, counts }
//   counts[tab] = { total, byUser } — 상태 타일·팀 칩 배지. 검색·팀 필터와 무관한 전체 값
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const tabParam = sp.get('tab') ?? 'open';
    if (!isCheckTab(tabParam)) {
      return NextResponse.json({ success: false, error: 'tab 값이 올바르지 않습니다.' }, { status: 400 });
    }
    const userId = str(sp.get('user_id'));
    if (userId && !UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'user_id 값이 올바르지 않습니다.' }, { status: 400 });
    }
    // 검색어 — PostgREST or() 필터 구분자(, ( ) )와 역슬래시 제거, 길이 제한
    const q = (sp.get('q') ?? '').trim().replace(/[,()\\]/g, '').slice(0, 60);
    const page = Math.max(1, int(sp.get('page')) ?? 1);
    const from = (page - 1) * CHECK_PAGE_SIZE;

    // ── 목록 ──
    let query = supabase
      .from('ft_customer_checks')
      .select('*', { count: 'exact' })
      .eq('status', CHECK_TAB_STATUS[tabParam])
      .order('created_at', { ascending: false })
      .range(from, from + CHECK_PAGE_SIZE - 1);
    if (userId) query = query.eq('user_id', userId);
    if (q) query = query.or(`order_no.ilike.%${q}%,item_no.ilike.%${q}%,item_name.ilike.%${q}%`);

    const listRes = await query;
    let listData = listRes.data;
    let listCount = listRes.count;
    if (listRes.error) {
      // 범위 밖 페이지 (PGRST103 "Requested range not satisfiable") — 데이터가 줄어 페이지가 비면
      // 빈 목록 + 전체 건수를 돌려주고, 화면이 마지막 페이지로 옮겨 간다
      if (listRes.error.code !== 'PGRST103') throw listRes.error;
      let countQuery = supabase
        .from('ft_customer_checks')
        .select('id', { count: 'exact', head: true })
        .eq('status', CHECK_TAB_STATUS[tabParam]);
      if (userId) countQuery = countQuery.eq('user_id', userId);
      if (q) countQuery = countQuery.or(`order_no.ilike.%${q}%,item_no.ilike.%${q}%,item_name.ilike.%${q}%`);
      const countRes = await countQuery;
      if (countRes.error) throw countRes.error;
      listData = [];
      listCount = countRes.count;
    }
    const count = listCount;
    const checks = (listData ?? []) as CustomerCheckRow[];
    const ids = checks.map((c) => c.id);

    // ── 댓글·이미지 수 (이 페이지의 건만) ──
    const commentCount = new Map<string, number>();
    const imageCount = new Map<string, number>();
    const lastRole = new Map<string, CheckAuthorRole>();
    if (ids.length > 0) {
      const [comments, images] = await Promise.all([
        fetchAllRows<{ check_id: string; author_role: CheckAuthorRole }>((a, b) =>
          supabase
            .from('ft_customer_check_comments')
            .select('check_id, author_role')
            .in('check_id', ids)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(a, b)
        ),
        fetchAllRows<{ check_id: string }>((a, b) =>
          supabase.from('ft_customer_check_images').select('check_id').in('check_id', ids).range(a, b)
        ),
      ]);
      comments.forEach((c) => {
        commentCount.set(c.check_id, (commentCount.get(c.check_id) ?? 0) + 1);
        lastRole.set(c.check_id, c.author_role);   // 시간순 → 마지막 값이 최근 댓글
      });
      images.forEach((i) => imageCount.set(i.check_id, (imageCount.get(i.check_id) ?? 0) + 1));
    }

    const rows: CustomerCheckListRow[] = checks.map((c) => ({
      ...c,
      comment_count: commentCount.get(c.id) ?? 0,
      image_count: imageCount.get(c.id) ?? 0,
      last_comment_role: lastRole.get(c.id) ?? null,
    }));

    // ── 건수 (필터 무관 전체) ──
    const counts = await fetchCounts();

    return NextResponse.json({
      success: true,
      rows,
      total: count ?? rows.length,
      page,
      pageSize: CHECK_PAGE_SIZE,
      counts,
    });
  } catch (error) {
    console.error('customer-checks GET 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '고객 검수 확인 목록을 불러오는 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
