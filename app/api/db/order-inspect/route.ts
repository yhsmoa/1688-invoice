import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../lib/supabase';
import { guardDbRoute } from '../../../../lib/dbAccess';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/db/order-inspect
//
// 1688 주문 엑셀을 업로드받아, 상품입고 V2(ft_order_items.1688_order_id)에
// 매칭되지 않는 주문번호를 찾아 반환한다.
//
// 엑셀 구조 (import-product-v2 의 1688 XLSX 와 동일 포맷)
//   A열(0)  주문번호   ┐
//   D열(3)  판매자명   │ 주문 단위 — 같은 주문이면 병합되어 첫 행에만 값이 있음
//   I열(8)  결제금액   │
//   K열(10) 주문일시   ┘
//   S열(18) 주문내역   ← 상품 단위 (병합 없음, 주문당 여러 행)
//
//   → 병합 셀은 첫 행에만 값이 있으므로 forward-fill 로 주문 단위 값을 이어받는다.
//
// 주문번호는 19자리 숫자라 JS number 로 읽으면 정밀도가 깨진다.
//   → sheet_to_json({ raw: false }) 로 항상 문자열로 읽는다.
//
// 주문내역(S열)은 중국어이므로 Google Cloud Translation API 로 한국어 번역.
//   API 미활성/실패 시에도 원문을 그대로 반환한다 (기능 중단 없음).
// ============================================================

const COL = {
  ORDER_NO: 0,   // A
  SHOP: 3,       // D
  AMOUNT: 8,     // I
  ORDERED_AT: 10, // K
  DETAIL: 18,    // S
} as const;

const IN_BATCH = 200;      // Supabase .in() 배치 크기
const TRANSLATE_BATCH = 100; // Translate API 배치 크기

interface InspectItem {
  detail: string;
  detailKo: string;
}

interface InspectOrder {
  orderNo: string;
  shop: string;
  amount: string;
  orderedAt: string;
  items: InspectItem[];
}

// ── 셀 → 문자열 (숫자/날짜 모두 표시값 기준) ──
const cellText = (v: unknown): string =>
  v === undefined || v === null ? '' : String(v).trim();

// ============================================================
// 중국어 → 한국어 번역 (Google Cloud Translation API v2)
//   실패 시 빈 Map 반환 → 호출부에서 원문 유지
// ============================================================
async function translateToKo(
  texts: string[]
): Promise<{ map: Map<string, string>; error: string | null }> {
  const map = new Map<string, string>();
  const unique = [...new Set(texts.filter((t) => t.trim()))];
  if (unique.length === 0) return { map, error: null };

  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return { map, error: 'GOOGLE_TRANSLATE_API_KEY(또는 GOOGLE_SHEETS_API_KEY)가 설정되지 않았습니다.' };
  }

  try {
    for (let i = 0; i < unique.length; i += TRANSLATE_BATCH) {
      const batch = unique.slice(i, i + TRANSLATE_BATCH);
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: batch, source: 'zh', target: 'ko', format: 'text' }),
        }
      );

      const json = await res.json();
      if (!res.ok) {
        return { map, error: json?.error?.message || `번역 API 오류 (${res.status})` };
      }

      const translations = json?.data?.translations ?? [];
      batch.forEach((src, idx) => {
        const out = translations[idx]?.translatedText;
        if (out) map.set(src, String(out));
      });
    }
    return { map, error: null };
  } catch (err) {
    return { map, error: err instanceof Error ? err.message : '번역 중 오류가 발생했습니다.' };
  }
}

export async function POST(request: NextRequest) {
  // ── 접근 권한 (DB 관리 메뉴 공통) ──
  const denied = await guardDbRoute(request);
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { success: false, error: '엑셀 파일이 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. 엑셀 파싱 (문자열 모드 — 19자리 주문번호 정밀도 보존) ──
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!worksheet) {
      return NextResponse.json(
        { success: false, error: '엑셀에서 시트를 찾을 수 없습니다.' },
        { status: 400 }
      );
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: '',
    });

    const dataRows = rows.slice(1); // 1행은 헤더

    // ── 2. 주문 단위로 그룹핑 (병합 셀 → forward-fill) ──
    const orderMap = new Map<string, InspectOrder>();
    const orderSeq: string[] = []; // 엑셀 등장 순서 유지
    let curNo = '';
    let curShop = '';
    let curAmount = '';
    let curOrderedAt = '';
    let totalItemRows = 0;

    for (const raw of dataRows) {
      const row = (raw ?? []) as unknown[];

      const no = cellText(row[COL.ORDER_NO]);
      const shop = cellText(row[COL.SHOP]);
      const amount = cellText(row[COL.AMOUNT]);
      const orderedAt = cellText(row[COL.ORDERED_AT]);
      const detail = cellText(row[COL.DETAIL]);

      // 병합 셀: 값이 있으면 갱신, 없으면 직전 주문 값을 이어받음
      if (no) {
        curNo = no;
        curShop = shop;
        curAmount = amount;
        curOrderedAt = orderedAt;
      } else {
        if (shop) curShop = shop;
        if (amount) curAmount = amount;
        if (orderedAt) curOrderedAt = orderedAt;
      }

      if (!curNo) continue;          // 주문번호 나오기 전 행
      if (!detail && !no) continue;  // 완전 빈 행

      if (!orderMap.has(curNo)) {
        orderMap.set(curNo, {
          orderNo: curNo,
          shop: curShop,
          amount: curAmount,
          orderedAt: curOrderedAt,
          items: [],
        });
        orderSeq.push(curNo);
      }

      if (detail) {
        orderMap.get(curNo)!.items.push({ detail, detailKo: detail });
        totalItemRows++;
      }
    }

    if (orderMap.size === 0) {
      return NextResponse.json(
        { success: false, error: '엑셀에서 주문번호(A열)를 찾을 수 없습니다.' },
        { status: 400 }
      );
    }

    // ── 3. ft_order_items 매칭 조회 (1688_order_id) ──
    const allOrderNos = orderSeq;
    const matched = new Set<string>();

    for (let i = 0; i < allOrderNos.length; i += IN_BATCH) {
      const batch = allOrderNos.slice(i, i + IN_BATCH);
      const { data, error } = await supabase
        .from('ft_order_items')
        .select('1688_order_id')
        .in('1688_order_id', batch);

      if (error) throw error;
      for (const r of data ?? []) {
        const v = (r as Record<string, unknown>)['1688_order_id'];
        if (v) matched.add(String(v).trim());
      }
    }

    // ── 4. 매칭 실패 주문만 추출 ──
    const unmatched = allOrderNos
      .filter((no) => !matched.has(no))
      .map((no) => orderMap.get(no)!);

    // ── 5. 주문내역(S열) 중국어 → 한국어 번역 ──
    const details = unmatched.flatMap((o) => o.items.map((it) => it.detail));
    const { map: koMap, error: translateError } = await translateToKo(details);

    for (const o of unmatched) {
      for (const it of o.items) {
        it.detailKo = koMap.get(it.detail) ?? it.detail;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalOrders: orderMap.size,
        matchedOrders: orderMap.size - unmatched.length,
        unmatchedOrders: unmatched.length,
        totalItemRows,
        unmatchedItemRows: unmatched.reduce((s, o) => s + o.items.length, 0),
      },
      translated: translateError === null && koMap.size > 0,
      translateError,
      orders: unmatched,
    });
  } catch (error) {
    console.error('주문 검사 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '엑셀 처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
