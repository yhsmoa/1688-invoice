import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/ft/shipment-v2/move
// 포장(PACKED) 행을 다른 박스로 이동 — 전체 이동 / 수량 분할 이동
//
// Body: {
//   user_id: string,
//   target_box_info_id: string,          // ft_box_info.id (박스코드는 출고 후 재사용되므로 id 로 지정)
//   moves: { id: string, quantity?: number }[]
//     · quantity 생략 → 전체 이동
//     · quantity 지정 → DB 수량과 같으면 전체, 작으면 분할 (판정은 DB 함수가 DB 수량 기준으로)
// }
//
// 처리: 행마다 rpc ft_move_outbound 1회 = 행마다 독립 트랜잭션
//   (supabase/shipment/001_move_outbound.sql — 박스 FOR SHARE / 행 FOR UPDATE 잠금)
//   일부 행이 실패해도 성공한 행은 유지하고, 결과를 행별로 나눠 돌려준다.
//
// Response: {
//   success: boolean,                    // 실패 행이 하나도 없으면 true
//   moved_full: number, moved_split: number, skipped: number,
//   failed: { id: string, error: string }[]
// }
// ============================================================

// ── rpc 오류 코드 → 사용자 문구 ──
const MOVE_ERROR_MESSAGE: Record<string, string> = {
  MOVE_BOX_NOT_FOUND: '이동할 박스를 찾을 수 없습니다.',
  MOVE_BOX_NOT_OPEN: '이동할 박스가 이미 출고되었거나 다른 사용자의 박스입니다.',
  MOVE_ROW_NOT_FOUND: '이동할 항목을 찾을 수 없습니다.',
  MOVE_ROW_NOT_MOVABLE: '이미 출고되었거나 이동할 수 없는 항목입니다.',
  MOVE_INVALID_QTY: '이동 수량이 현재 수량보다 많거나 올바르지 않습니다.',
};

const toMoveErrorMessage = (raw: string | undefined): string => {
  if (!raw) return '알 수 없는 오류';
  const code = Object.keys(MOVE_ERROR_MESSAGE).find((k) => raw.includes(k));
  return code ? MOVE_ERROR_MESSAGE[code] : raw;
};

interface MoveInput {
  id: string;
  quantity?: number;
}

interface MoveRpcRow {
  result: 'FULL' | 'SPLIT' | 'SKIPPED';
  moved_id: string;
  moved_qty: number;
}

const fail = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

// ============================================================
// POST
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, target_box_info_id, moves } = body as {
      user_id?: unknown;
      target_box_info_id?: unknown;
      moves?: unknown;
    };

    // ── 1) 입력 검증 ──
    if (typeof user_id !== 'string' || !user_id) return fail('user_id 가 필요합니다.');
    if (typeof target_box_info_id !== 'string' || !target_box_info_id) {
      return fail('이동할 박스를 선택해주세요.');
    }
    if (!Array.isArray(moves) || moves.length === 0) return fail('이동할 항목이 없습니다.');

    const parsed: MoveInput[] = [];
    for (const m of moves as Record<string, unknown>[]) {
      if (!m || typeof m.id !== 'string' || !m.id) return fail('이동 항목 id 가 올바르지 않습니다.');
      if (m.quantity !== undefined && m.quantity !== null) {
        const q = m.quantity;
        if (typeof q !== 'number' || !Number.isInteger(q) || q <= 0) {
          return fail('이동 수량은 1 이상의 정수여야 합니다.');
        }
        parsed.push({ id: m.id, quantity: q });
      } else {
        parsed.push({ id: m.id });
      }
    }

    // 같은 행이 두 번 오면 두 번째가 수량을 또 옮기게 되므로 거부
    if (new Set(parsed.map((m) => m.id)).size !== parsed.length) {
      return fail('같은 항목이 중복으로 포함되어 있습니다.');
    }

    // ── 2) 대상 박스 사전 검증 (행 처리 전에 명확한 안내) — 최종 검증은 rpc 가 잠금과 함께 다시 수행 ──
    const { data: box, error: boxErr } = await supabase
      .from('ft_box_info')
      .select('id, user_id, shipment_id, status')
      .eq('id', target_box_info_id)
      .maybeSingle();

    if (boxErr) throw boxErr;
    if (!box) return fail(MOVE_ERROR_MESSAGE.MOVE_BOX_NOT_FOUND, 404);
    if (box.user_id !== user_id || box.shipment_id || box.status !== 'PACKING') {
      return fail(MOVE_ERROR_MESSAGE.MOVE_BOX_NOT_OPEN, 409);
    }

    // ── 3) 행별 이동 (순차 — 같은 박스 잠금을 두고 경합하지 않도록) ──
    let movedFull = 0;
    let movedSplit = 0;
    let skipped = 0;
    const failed: { id: string; error: string }[] = [];

    for (const m of parsed) {
      const { data, error } = await supabase.rpc('ft_move_outbound', {
        p_id: m.id,
        p_box_info_id: target_box_info_id,
        p_user_id: user_id,
        p_qty: m.quantity ?? null,
      });

      if (error) {
        failed.push({ id: m.id, error: toMoveErrorMessage(error.message) });
        continue;
      }

      const row = (data as MoveRpcRow[] | null)?.[0];
      if (row?.result === 'FULL') movedFull += 1;
      else if (row?.result === 'SPLIT') movedSplit += 1;
      else if (row?.result === 'SKIPPED') skipped += 1;
    }

    return NextResponse.json({
      success: failed.length === 0,
      moved_full: movedFull,
      moved_split: movedSplit,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('shipment-v2 move 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '박스 이동 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
