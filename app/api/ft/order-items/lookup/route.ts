import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { FT_ORDER_ITEMS_DISPLAY_SELECT } from '../../../../../lib/ftOrderItemsSelect';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/ft/order-items/lookup?code=…
//
// 탑메뉴 [BARCODE] 모달 — 스캐너가 읽은 값으로 상품 행을 찾는다.
//
//   라벨 스티커 템플릿의 QR 은 product_no, 1D 바코드는 barcode(안녕릴리는 product_no)를
//   담고 있고, 작업자가 item_no 를 직접 칠 수도 있다 → 세 컬럼을 한 번에 정확 일치로 찾는다.
//
// 묶음 규칙 (같은 상품이 여러 주문행에 있을 때 한 줄로):
//   · 세트(set_total > 1)      → product_no 기준 1줄 (printLabels 의 세트 병합과 같은 기준)
//   · 그 외                    → item_no 기준 1줄, item_no 가 없으면 barcode 기준
//   · 대표 행 = 가장 최근 created_at (라벨 데이터는 최신 주문 기준으로 찍는다)
//   · 최대 MAX_ROWS 줄까지만 돌려주고 truncated 로 알린다
//
// 응답: { success, code, matchedBy, totalMatched, truncated, rows: FtOrderItem[], users: {[id]: FtUser} }
//   users 는 /api/ft/users 와 같은 정제(비밀번호 제외) — 템플릿 선택·계정 바인딩용
// ============================================================

/** 스캔 값 허용 문자 — 바코드·상품번호·아이템번호에 쓰이는 글자만 (PostgREST or() 필터 안전) */
const CODE_RE = /^[A-Za-z0-9_.\-]{1,64}$/;
const FETCH_LIMIT = 200;
const MAX_ROWS = 20;
const SENSITIVE_USER_COLUMNS = new Set(['password']);

type MatchedBy = 'product_no' | 'item_no' | 'barcode';

interface LookupRow {
  id: string;
  user_id: string | null;
  product_no: string | null;
  item_no: string | null;
  barcode: string | null;
  set_total: number | null;
  created_at: string | null;
  [key: string]: unknown;
}

/** 묶음 키 — 세트는 product_no, 그 외는 item_no → barcode → 행 id 순 */
function groupKey(row: LookupRow): string {
  if ((row.set_total ?? 0) > 1 && row.product_no) return `set:${row.product_no}`;
  if (row.item_no) return `item:${row.item_no}`;
  if (row.barcode) return `bc:${row.barcode}`;
  return `id:${row.id}`;
}

export async function GET(request: NextRequest) {
  try {
    const raw = new URL(request.url).searchParams.get('code') ?? '';
    const code = raw.replace(/\s/g, '');
    if (!code) {
      return NextResponse.json({ success: false, error: 'code 파라미터가 필요합니다.' }, { status: 400 });
    }
    if (!CODE_RE.test(code)) {
      return NextResponse.json(
        { success: false, error: '스캔 값에 쓸 수 없는 문자가 있습니다. (영문·숫자·-_. 만 허용)' },
        { status: 400 }
      );
    }

    // ── 1) 세 컬럼 정확 일치 — 최신순 ──
    const { data, error } = await supabase
      .from('ft_order_items')
      .select(FT_ORDER_ITEMS_DISPLAY_SELECT)
      .or(`product_no.eq.${code},item_no.eq.${code},barcode.eq.${code}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw error;

    const all = (data ?? []) as unknown as LookupRow[];
    if (all.length === 0) {
      return NextResponse.json({
        success: true, code, matchedBy: null, totalMatched: 0, truncated: false, rows: [], users: {},
      });
    }

    // ── 2) 어떤 컬럼으로 맞았는지 (안내용) — product_no > item_no > barcode 우선 ──
    let matchedBy: MatchedBy = 'barcode';
    if (all.some((r) => r.product_no === code)) matchedBy = 'product_no';
    else if (all.some((r) => r.item_no === code)) matchedBy = 'item_no';

    // ── 3) 묶음 — 키별 첫 행(=최신) 대표 ──
    const seen = new Set<string>();
    const rows: LookupRow[] = [];
    for (const r of all) {
      const key = groupKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
    const truncated = rows.length > MAX_ROWS || all.length >= FETCH_LIMIT;
    const limited = rows.slice(0, MAX_ROWS);

    // ── 4) 사업자 정보 (비밀번호 제외) ──
    const userIds = Array.from(new Set(limited.map((r) => r.user_id).filter((v): v is string => !!v)));
    const users: Record<string, Record<string, unknown>> = {};
    if (userIds.length > 0) {
      const { data: userRows, error: userErr } = await supabase
        .from('ft_users')
        .select('*')
        .in('id', userIds);
      if (userErr) throw userErr;
      for (const u of (userRows ?? []) as Record<string, unknown>[]) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(u)) if (!SENSITIVE_USER_COLUMNS.has(k)) out[k] = v;
        users[String(u.id)] = out;
      }
    }

    return NextResponse.json({
      success: true,
      code,
      matchedBy,
      totalMatched: all.length,
      truncated,
      rows: limited,
      users,
    });
  } catch (error) {
    console.error('상품 조회(lookup) 오류:', error);
    return NextResponse.json(
      { success: false, error: '상품 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
