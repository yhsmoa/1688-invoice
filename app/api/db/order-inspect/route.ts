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
//   J열(9)  주문상태   │ → 한국어 라벨 + 거래/환불/취소 구분 (ORDER_STATUS)
//   K열(10) 주문일시   │
//   N열(13) 받는 사람  │
//   AD열(29) 구매자 메모┘
//   S열(18) 주문내역   ┐ 상품 단위 (병합 없음, 주문당 여러 행)
//   U열(20) 수량       ┘
//
//   → 병합 셀은 첫 행에만 값이 있으므로 forward-fill 로 주문 단위 값을 이어받는다.
//
// 주문번호는 19자리 숫자라 JS number 로 읽으면 정밀도가 깨진다.
//   → sheet_to_json({ raw: false }) 로 항상 문자열로 읽는다.
//
// 주문내역(S열)·사전에 없는 주문상태는 중국어이므로 Google Cloud Translation API 로 한국어 번역.
//   API 미활성/실패 시에도 원문을 그대로 반환한다 (기능 중단 없음).
//
// 비용처리 기록 여부 (recorded)
//   미매칭 주문은 ft_order_items 에 안 잡히므로 엑셀을 다시 올리면 또 나온다.
//   이미 [비용처리] 한 주문을 다시 기록하지 않도록 두 원장을 조회해 돌려준다.
//     · 회사 부담 → ft_trade_transactions.order_no_1688 = 주문번호, kind = 'company' (취소(reversal)된 행 제외)
//     · 고객 부담 → ft_user_transactions.order_no_1688 = 주문번호, type = 'out'
//   (참조키 TRADE-1688-* / MANUAL-차감-1688-* 는 중복 저장 차단용이고 조회에는 쓰지 않는다)
// ============================================================

const COL = {
  ORDER_NO: 0,   // A
  SHOP: 3,       // D
  AMOUNT: 8,     // I
  STATUS: 9,     // J
  ORDERED_AT: 10, // K
  RECEIVER: 13,  // N
  DETAIL: 18,    // S
  QTY: 20,       // U
  MEMO: 29,      // AD
} as const;

// ============================================================
// 1688 주문상태(J열) → 한국어 라벨 + 구분
//   tone: active(실거래) / refund(환불 진행) / cancel(취소·종료) / etc(사전에 없음)
//   사전에 없는 값은 번역 API 결과를 라벨로 쓰고 tone 은 etc 로 둔다.
// ============================================================
type StatusTone = 'active' | 'refund' | 'cancel' | 'etc';

const ORDER_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  等待买家付款:     { label: '결제 대기', tone: 'etc' },
  等待卖家发货:     { label: '발송 대기', tone: 'active' },
  等待买家确认收货: { label: '발송됨 (수령확인 대기)', tone: 'active' },
  交易成功:         { label: '거래 완료', tone: 'active' },
  退款中:           { label: '환불 진행중', tone: 'refund' },
  交易关闭:         { label: '거래 취소', tone: 'cancel' },
  terminated:       { label: '거래 종료', tone: 'cancel' },
};

const IN_BATCH = 200;      // Supabase .in() 배치 크기
const TRANSLATE_BATCH = 100; // Translate API 배치 크기

interface InspectItem {
  detail: string;
  detailKo: string;
  qty: string;         // U열 표시값 (예: "100")
}

/** 비용처리 기록 대상 — 화면 types.ts 의 CostTarget 과 동일 */
type CostTarget = 'trade' | 'customer';

interface InspectOrder {
  orderNo: string;
  shop: string;
  amount: string;
  status: string;      // J열 원문
  statusKo: string;    // 한국어 라벨
  statusTone: StatusTone;
  orderedAt: string;
  receiver: string;    // N열
  memo: string;        // AD열
  items: InspectItem[];
  recorded: CostTarget[]; // 이미 기록된 비용처리 (없으면 [])
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
    let curStatus = '';
    let curOrderedAt = '';
    let curReceiver = '';
    let curMemo = '';
    let totalItemRows = 0;

    for (const raw of dataRows) {
      const row = (raw ?? []) as unknown[];

      const no = cellText(row[COL.ORDER_NO]);
      const shop = cellText(row[COL.SHOP]);
      const amount = cellText(row[COL.AMOUNT]);
      const status = cellText(row[COL.STATUS]);
      const orderedAt = cellText(row[COL.ORDERED_AT]);
      const receiver = cellText(row[COL.RECEIVER]);
      const memo = cellText(row[COL.MEMO]);
      const detail = cellText(row[COL.DETAIL]);
      const qty = cellText(row[COL.QTY]);

      // 병합 셀: 값이 있으면 갱신, 없으면 직전 주문 값을 이어받음
      if (no) {
        curNo = no;
        curShop = shop;
        curAmount = amount;
        curStatus = status;
        curOrderedAt = orderedAt;
        curReceiver = receiver;
        curMemo = memo;
      } else {
        if (shop) curShop = shop;
        if (amount) curAmount = amount;
        if (status) curStatus = status;
        if (orderedAt) curOrderedAt = orderedAt;
        if (receiver) curReceiver = receiver;
        if (memo) curMemo = memo;
      }

      if (!curNo) continue;          // 주문번호 나오기 전 행
      if (!detail && !no) continue;  // 완전 빈 행

      if (!orderMap.has(curNo)) {
        orderMap.set(curNo, {
          orderNo: curNo,
          shop: curShop,
          amount: curAmount,
          status: curStatus,
          statusKo: ORDER_STATUS[curStatus]?.label ?? curStatus,
          statusTone: ORDER_STATUS[curStatus]?.tone ?? 'etc',
          orderedAt: curOrderedAt,
          receiver: curReceiver,
          memo: curMemo,
          items: [],
          recorded: [],
        });
        orderSeq.push(curNo);
      }

      if (detail) {
        orderMap.get(curNo)!.items.push({ detail, detailKo: detail, qty });
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

    // ── 4-1. 비용처리 기록 여부 — 두 원장 조회 (주문번호 목록 기준, 200건 배치) ──
    const unmatchedNos = unmatched.map((o) => o.orderNo);
    const recordedTrade = new Set<string>();
    const recordedCustomer = new Set<string>();

    for (let i = 0; i < unmatchedNos.length; i += IN_BATCH) {
      const batch = unmatchedNos.slice(i, i + IN_BATCH);

      // 회사 부담: 1688 주문번호 컬럼으로 조회 → 취소(reversal)된 행은 제외
      //   (무역계좌 [회사 거래 추가] 에서 주문번호를 적어 넣은 건도 함께 잡힌다)
      const { data: tradeRows, error: tradeErr } = await supabase
        .from('ft_trade_transactions')
        .select('id, order_no_1688')
        .eq('kind', 'company')
        .in('order_no_1688', batch);
      if (tradeErr) throw tradeErr;

      const tradeIds = (tradeRows ?? []).map((r) => String(r.id));
      const reversed = new Set<string>();
      if (tradeIds.length > 0) {
        const { data: revRows, error: revErr } = await supabase
          .from('ft_trade_transactions')
          .select('reverses_id')
          .in('reverses_id', tradeIds);
        if (revErr) throw revErr;
        for (const r of revRows ?? []) if (r.reverses_id) reversed.add(String(r.reverses_id));
      }
      for (const r of tradeRows ?? []) {
        if (reversed.has(String(r.id))) continue;
        const no = r.order_no_1688 ? String(r.order_no_1688).trim() : '';
        if (no) recordedTrade.add(no);
      }

      // 고객 부담: 1688 주문번호 열로 조회 (주문 검사·고객계좌(신) 수동 차감 모두 포함)
      const { data: custRows, error: custErr } = await supabase
        .from('ft_user_transactions')
        .select('order_no_1688')
        .eq('type', 'out')
        .in('order_no_1688', batch);
      if (custErr) throw custErr;
      for (const r of custRows ?? []) {
        const no = r.order_no_1688 ? String(r.order_no_1688).trim() : '';
        if (no) recordedCustomer.add(no);
      }
    }

    for (const o of unmatched) {
      if (recordedTrade.has(o.orderNo)) o.recorded.push('trade');
      if (recordedCustomer.has(o.orderNo)) o.recorded.push('customer');
    }

    // ── 5. 주문내역(S열) + 사전에 없는 주문상태(J열) 중국어 → 한국어 번역 ──
    const details = unmatched.flatMap((o) => o.items.map((it) => it.detail));
    const unknownStatuses = unmatched
      .map((o) => o.status)
      .filter((st) => st && !ORDER_STATUS[st]);
    const { map: koMap, error: translateError } = await translateToKo([...details, ...unknownStatuses]);

    for (const o of unmatched) {
      if (o.status && !ORDER_STATUS[o.status]) o.statusKo = koMap.get(o.status) ?? o.status;
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
