import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// ============================================================
// POST /api/add-customs-item — 통관정보(invoiceManager-Customs) 1건 추가
//
//   body: { item_name_ko, item_name_en, HS_code?, CO? }
//   · HS_code 는 선택 — 비우면 NULL 로 저장 (supabase/customs/001_customs_id_pk.sql)
//     값이 있으면 UNIQUE — 이미 있으면 덮어쓰지 않고 409 (수정은 엑셀 업로드로)
//   · item_name_ko 는 쉽먼트 품목 저장 키(ft_order_items.customs_category)라 필수.
//     같은 한글이 HS CODE 별로 여러 행일 수 있어(가방 3종) 한글 중복은 허용한다
//   · item_name_en 은 테이블 NOT NULL — 쉽먼트 화면 표시값
// ============================================================

// PostgreSQL unique_violation
const PG_UNIQUE_VIOLATION = '23505';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── 입력 정리 · 검증 ──
    const row = {
      item_name_ko: str(body?.item_name_ko),
      item_name_en: str(body?.item_name_en),
      HS_code: str(body?.HS_code) || null,
      CO: str(body?.CO),
    };

    if (!row.item_name_ko || !row.item_name_en) {
      return NextResponse.json(
        { success: false, error: '품명(한글) · 품명(영문) 은 필수입니다.' },
        { status: 400 }
      );
    }

    // ── 저장 (insert — 기존 행 덮어쓰기 방지) ──
    const { data, error } = await supabase
      .from('invoiceManager-Customs')
      .insert(row)
      .select('id, HS_code, item_name_ko, item_name_en, CO')
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return NextResponse.json(
          { success: false, error: `이미 등록된 HS CODE 입니다: ${row.HS_code}` },
          { status: 409 }
        );
      }
      console.error('통관정보 추가 오류:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('통관정보 추가 오류:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' },
      { status: 500 }
    );
  }
}
