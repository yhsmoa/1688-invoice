import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/ft/order-items/match-order-id
//
// 1688 엑셀 파일을 업로드하여 ft_order_items.1688_order_id 를 매칭·저장
//
// 로직:
//   1) ft_order_items 에서 1688_order_id IS NULL 인 행 조회
//      → 필요한 필드: id, order_no, 1688_offer_id
//   2) 엑셀 파일 파싱 (병합 셀 처리 포함)
//      → A열: 1688 주문 ID (병합셀)
//      → Y열: Offer ID (비병합)
//      → AD열: note (병합셀) — "ORDER_NO | ... | items"
//   3) note에서 order_no 추출 (첫 번째 " | " 앞 부분)
//   4) DB 행과 엑셀 행 매칭: order_no + 1688_offer_id → A열 값을 1688_order_id로 저장
// ============================================================

// ── 엑셀 컬럼 인덱스 ─────────────────────────────────────────
const COL = {
  ORDER_ID_1688: 0,  // A열 — 1688 주문 ID (병합셀)
  OFFER_ID: 24,      // Y열 — Offer ID (비병합)
  NOTE: 29,          // AD열 — note (병합셀)
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 업로드되지 않았습니다.' },
        { status: 400 }
      );
    }

    // ============================================================
    // 1) DB 조회 — 1688_order_id IS NULL 인 항목
    // ============================================================
    const { data: nullItems, error: dbError } = await supabase
      .from('ft_order_items')
      .select('id, order_no, 1688_offer_id')
      .is('1688_order_id', null);

    if (dbError) throw dbError;

    if (!nullItems || nullItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: '1688_order_id가 비어있는 항목이 없습니다.',
        matched: 0,
      });
    }

    // ── DB 항목을 "order_no + offer_id" 키로 인덱싱 ──────────
    // 하나의 키에 여러 아이템이 매핑될 수 있으므로 배열로 관리
    const dbMap = new Map<string, { id: string }[]>();
    for (const item of nullItems) {
      const orderNo = (item.order_no || '').trim();
      const offerId = ((item as Record<string, unknown>)['1688_offer_id'] as string || '').trim();
      if (!orderNo || !offerId) continue;

      const key = `${orderNo}__${offerId}`;
      const arr = dbMap.get(key) || [];
      arr.push({ id: item.id });
      dbMap.set(key, arr);
    }

    // ============================================================
    // 2) 엑셀 파일 파싱 (병합 셀 처리)
    // ============================================================
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const dataRows = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][]).slice(1);
    const merges: XLSX.Range[] = worksheet['!merges'] || [];

    // ── 병합 셀 값 조회 함수 ─────────────────────────────────
    // dataRowIndex: dataRows 배열 인덱스 (헤더 제외 0-based)
    const getMergedValue = (dataRowIndex: number, colIndex: number): unknown => {
      const sheetRow = dataRowIndex + 1; // 실제 시트 행 (0-based, 헤더 1행 제외)
      for (const merge of merges) {
        if (
          sheetRow >= merge.s.r && sheetRow <= merge.e.r &&
          colIndex >= merge.s.c && colIndex <= merge.e.c
        ) {
          const startIdx = merge.s.r - 1; // dataRows 인덱스로 변환
          if (startIdx >= 0 && dataRows[startIdx]) {
            return dataRows[startIdx][colIndex];
          }
        }
      }
      return null;
    };

    // 셀 값: 직접 값 > 병합 시작 셀 값
    const cell = (rowIdx: number, colIdx: number): string => {
      const raw = dataRows[rowIdx]?.[colIdx];
      const val = (raw !== undefined && raw !== null && String(raw).trim() !== '')
        ? raw
        : getMergedValue(rowIdx, colIdx);
      return val != null ? String(val).trim() : '';
    };

    // ============================================================
    // 3) 엑셀 행 → 매칭 데이터 수집
    //    note에서 order_no 추출: 첫 번째 " | " 앞 부분
    // ============================================================
    const updates: { id: string; orderId1688: string }[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const orderId1688 = cell(i, COL.ORDER_ID_1688);
      const offerId = cell(i, COL.OFFER_ID);
      const note = cell(i, COL.NOTE);

      if (!orderId1688 || !offerId || !note) continue;

      // note 형식: "ORMB260305-S33 | MB-260305 | 0008-A01:10, ..."
      // 첫 번째 " | " 앞 = order_no
      const pipeIdx = note.indexOf(' | ');
      const orderNo = pipeIdx >= 0 ? note.substring(0, pipeIdx).trim() : note.trim();

      if (!orderNo) continue;

      // ── DB 매칭: order_no + offer_id ──
      const key = `${orderNo}__${offerId}`;
      const matched = dbMap.get(key);
      if (matched) {
        for (const item of matched) {
          updates.push({ id: item.id, orderId1688 });
        }
        // 매칭된 항목 제거 (중복 방지)
        dbMap.delete(key);
      }
    }

    // ============================================================
    // 4) Supabase 업데이트 — 배치 처리
    // ============================================================
    let updatedCount = 0;

    for (const { id, orderId1688 } of updates) {
      const { error: updateError } = await supabase
        .from('ft_order_items')
        .update({ '1688_order_id': orderId1688 })
        .eq('id', id);

      if (!updateError) {
        updatedCount++;
      } else {
        console.error(`1688_order_id 업데이트 실패 (id: ${id}):`, updateError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `${updatedCount}개 항목의 1688_order_id가 업데이트되었습니다.`,
      matched: updatedCount,
      total_null: nullItems.length,
    });

  } catch (error) {
    console.error('1688_order_id 매칭 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '1688_order_id 매칭 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
