import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';
import { badgesForOrders, lookupOrderXlsx } from '../../../../../lib/orderXlsxLookup';
import {
  SELLER_INQUIRY_TABLES as T,
  SELLER_INQUIRY_TRANSITIONS,
  isSellerInquiryStatus,
  type SellerInquiryDetail,
  type SellerInquiryItemRow,
  type SellerInquiryPhotoRow,
  type SellerInquiryRow,
  type SellerInquiryStatus,
} from '../../../../../lib/sellerInquiries';
import {
  appendMemoLine,
  deleteMemoLine,
  editMemoLine,
  parseMemoLines,
  sanitizeMemoText,
} from '../../../../../lib/memoLog';

export const dynamic = 'force-dynamic';

// ============================================================
// /api/ft/seller-inquiries/[id]
//   GET   : 상세 (접수 + 부족 행 + 사진) — 부족 행마다 1688 계정 배지 (lib/orderXlsxLookup)
//   PATCH : 상태 전이 · 메모 줄 조작
//           body: { status?, memo_op? }   (자유 형식 memo 필드는 없앴다 — 덮어쓰기 방지)
//           memo_op — 메모 줄 기록 (lib/memoLog) 한 줄 단위:
//             { op:'add', text }                 맨 아래에 KST 도장 + 내용
//             { op:'edit', index, prev, text }   그 줄 내용만 (도장 유지)
//             { op:'delete', index, prev }       그 줄 삭제
//             prev = 화면이 본 그 줄 원문. DB 의 줄과 다르면 409 (다른 작업자가 먼저 바꿈)
//             저장은 조건부 UPDATE (updated_at 이 읽은 값 그대로일 때만) — 그 사이 바뀌었으면 409
//           status 는 SELLER_INQUIRY_TRANSITIONS 의 허용 전이만, 조건부 UPDATE 로 동시 변경을 막는다
//           전이 시각: 문의중 → inquiring_at, 처리완료 → completed_at (되돌리면 completed_at 비움)
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// memo_op 검증
// ============================================================
type MemoOp =
  | { op: 'add'; text: string }
  | { op: 'edit'; index: number; prev: string; text: string }
  | { op: 'delete'; index: number; prev: string };

/** 올바르면 MemoOp, 아니면 오류 문구 */
function parseMemoOp(v: unknown): MemoOp | string {
  if (!v || typeof v !== 'object') return 'memo_op 형식이 올바르지 않습니다.';
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? sanitizeMemoText(o.text) : '';
  const index = typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 0 ? o.index : null;
  const prev = typeof o.prev === 'string' ? o.prev : null;
  switch (o.op) {
    case 'add':
      return text ? { op: 'add', text } : '메모 내용을 입력해주세요.';
    case 'edit':
      if (index === null || prev === null) return 'memo_op 의 index · prev 가 올바르지 않습니다.';
      return text ? { op: 'edit', index, prev, text } : '메모 내용을 입력해주세요.';
    case 'delete':
      if (index === null || prev === null) return 'memo_op 의 index · prev 가 올바르지 않습니다.';
      return { op: 'delete', index, prev };
    default:
      return 'memo_op.op 값이 올바르지 않습니다.';
  }
}

const MEMO_CONFLICT = '다른 작업자가 먼저 메모를 바꿨습니다. 새로고침 후 다시 시도하세요.';

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
  const itemRows = (items.data ?? []) as SellerInquiryItemRow[];
  const xlsxInfo = await lookupOrderXlsx(itemRows.map((it) => it.order_id_1688));
  return {
    ...(main as SellerInquiryRow),
    items: itemRows.map((it) => ({
      ...it,
      account_badges: it.order_id_1688 ? badgesForOrders([it.order_id_1688.trim()], xlsxInfo) : [],
    })),
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
    const hasMemoOp = body?.memo_op !== undefined;
    if (!hasStatus && !hasMemoOp) {
      return NextResponse.json({ success: false, error: '바꿀 내용이 없습니다.' }, { status: 400 });
    }
    if (hasStatus && !isSellerInquiryStatus(body.status)) {
      return NextResponse.json({ success: false, error: 'status 값이 올바르지 않습니다.' }, { status: 400 });
    }

    // ── 메모 줄 조작 ──
    if (hasMemoOp) {
      const op = parseMemoOp(body.memo_op);
      if (typeof op === 'string') return NextResponse.json({ success: false, error: op }, { status: 400 });

      const { data: cur, error: curErr } = await supabase.from(T.main).select('memo, updated_at').eq('id', params.id).maybeSingle();
      if (curErr) throw curErr;
      if (!cur) return NextResponse.json({ success: false, error: '접수를 찾을 수 없습니다.' }, { status: 404 });
      const curMemo = (cur.memo as string | null) ?? null;

      // 화면이 본 줄과 DB 의 줄이 다르면 (다른 PC 가 먼저 수정·삭제) 덮어쓰지 않는다
      if (op.op !== 'add') {
        const lines = parseMemoLines(curMemo);
        if (op.index >= lines.length || lines[op.index].raw !== op.prev) {
          return NextResponse.json({ success: false, error: MEMO_CONFLICT }, { status: 409 });
        }
      }
      const nextMemo =
        op.op === 'add' ? appendMemoLine(curMemo, op.text, new Date())
        : op.op === 'edit' ? editMemoLine(curMemo, op.index, op.text)
        : deleteMemoLine(curMemo, op.index);

      // 조건부 UPDATE — 읽은 뒤 그 사이 다른 PC 가 행을 바꿨으면 (updated_at 트리거, 001 SQL) 0행
      const { data: upd, error: updErr } = await supabase
        .from(T.main)
        .update({ memo: nextMemo })
        .eq('id', params.id)
        .eq('updated_at', cur.updated_at)
        .select('id');
      if (updErr) throw updErr;
      if (!upd || upd.length === 0) {
        return NextResponse.json({ success: false, error: MEMO_CONFLICT }, { status: 409 });
      }
    }

    // ── 상태 전이 ──
    if (hasStatus) {
      const next: SellerInquiryStatus = body.status;
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
