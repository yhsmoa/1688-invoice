import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// ============================================================
// POST /api/search-1688-order
//
// order_number (쿠팡) → 1688 order_id 매핑 후 DB 업데이트
//
// 매칭 방식 (신규 order_info 포맷):
//   order_info = "ORBZ260225-K51 | BZ-260225 | 0005-A01:2, 0006-A01:2"
//   → 파싱 키: BZ-260225-0005-A01, BZ-260225-0006-A01
//
// 쿠팡 order_number 정규화:
//   BZ-260225-0006-A01C1  →  # 제거 + C\d+ 제거  →  BZ-260225-0006-A01
// ============================================================

// ── 쿠팡 order_number 정규화 ──────────────────────────────────
// 1) # 이후 제거
// 2) 끝의 C+숫자 접미사 제거 (C1, C2, C10 등)
function normalizeOrderNumber(orderNumber: string): string {
  let result = orderNumber.trim();
  const hashIdx = result.indexOf('#');
  if (hashIdx > 0) result = result.substring(0, hashIdx);
  result = result.replace(/C\d+$/, '');
  return result;
}

// ── order_info 파싱 → 비교 키 배열 반환 ──────────────────────
// 신규 포맷: "ORBZ260225-K51 | BZ-260225 | 0005-A01:2, 0006-A01:2"
// → ["BZ-260225-0005-A01", "BZ-260225-0006-A01"]
//
// 구형 포맷 (// 구분): "BO-251016-0096 // 灰色 | 130cm // ..."
// → ["BO-251016-0096"]  (하위 호환 유지)
function parseOrderInfoKeys(orderInfo: string): string[] {
  if (!orderInfo) return [];

  // ── 신규 포맷: "|" 구분자 3개 섹션 ──────────────────────────
  const pipeParts = orderInfo.split('|').map(s => s.trim());
  if (pipeParts.length >= 3) {
    const prefix = pipeParts[1]; // "BZ-260225"
    const itemsStr = pipeParts[2]; // "0005-A01:2, 0006-A01:2"

    const keys = itemsStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(item => {
        // "0006-A01:2" → `:숫자` 앞까지만 ("0006-A01")
        const colonIdx = item.search(/:\d/);
        const itemKey = colonIdx > 0 ? item.substring(0, colonIdx) : item;
        return `${prefix}-${itemKey.trim()}`;
      });

    if (keys.length > 0) return keys;
  }

  // ── 구형 포맷: "//" 구분, 첫 번째 부분이 주문번호 ──────────
  if (orderInfo.includes('//')) {
    const firstPart = orderInfo.split('//')[0].trim();
    if (firstPart) return [firstPart];
  }

  return [];
}

// ── order_number에서 날짜 prefix 추출 ─────────────────────────
// "BZ-260225-0006-A01" → "BZ-260225"  (앞 2개 세그먼트)
function extractPrefix(normalized: string): string {
  const parts = normalized.split('-');
  return parts.slice(0, 2).join('-');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderData, user_id } = body;

    if (!orderData || !Array.isArray(orderData) || orderData.length === 0) {
      return NextResponse.json(
        { success: false, error: 'orderData 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. 쿠팡 order_number 정규화 + prefix 수집 ───────────────
    const normalizedMap = new Map<string, string>(); // item.id → normalized
    const prefixSet = new Set<string>();

    for (const item of orderData as { id: string; order_number: string | null }[]) {
      if (!item.order_number) continue;
      const normalized = normalizeOrderNumber(item.order_number);
      normalizedMap.set(item.id, normalized);
      prefixSet.add(extractPrefix(normalized));
    }

    if (normalizedMap.size === 0) {
      return NextResponse.json(
        { success: false, error: '조회할 주문번호가 없습니다.' },
        { status: 400 }
      );
    }

    // ── 2. prefix 기반으로 관련 order_info 행 조회 ───────────────
    // 각 prefix로 order_info ILIKE 검색 (배치)
    let allDeliveryRows: { order_info: string; order_id: string }[] = [];
    const prefixes = [...prefixSet];

    for (const prefix of prefixes) {
      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('order_info, order_id')
        .ilike('order_info', `%| ${prefix} |%`);

      if (error) {
        return NextResponse.json(
          { success: false, error: '1688 주문 정보 조회 실패', details: error.message },
          { status: 500 }
        );
      }
      if (data) allDeliveryRows = allDeliveryRows.concat(data);
    }

    // ── 3. order_info 파싱 → 비교키 → order_id 매핑 빌드 ────────
    // keyMapping: "BZ-260225-0006-A01" → order_id
    const keyMapping: Record<string, string> = {};

    for (const row of allDeliveryRows) {
      if (!row.order_info || !row.order_id) continue;
      const keys = parseOrderInfoKeys(row.order_info);
      for (const key of keys) {
        keyMapping[key] = row.order_id;
      }
    }

    // ── 4. invoiceManager_refundOrder 업데이트 ───────────────────
    const updateBatchSize = 100;
    let successCount = 0;

    for (let i = 0; i < orderData.length; i += updateBatchSize) {
      const batch = (orderData as { id: string; order_number: string | null }[]).slice(i, i + updateBatchSize);

      const updatePromises = batch.map((item) => {
        const normalized = normalizedMap.get(item.id);
        const orderId = normalized ? keyMapping[normalized] : null;

        if (!orderId) {
          return Promise.resolve({ data: null, error: null });
        }

        return supabase
          .from('invoiceManager_refundOrder')
          .update({ '1688_order_number': orderId, updated_at: new Date().toISOString() })
          .eq('id', item.id)
          .select();
      });

      const results = await Promise.all(updatePromises);
      successCount += results.filter(r => r.data && (r.data as unknown[]).length > 0).length;

      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        console.error('일부 업데이트 실패:', errors);
      }
    }

    // ── 5. 찾지 못한 목록 ────────────────────────────────────────
    const notFound = (orderData as { id: string; order_number: string | null }[])
      .filter(item => {
        const normalized = normalizedMap.get(item.id);
        return item.order_number && normalized && !keyMapping[normalized];
      })
      .map(item => item.order_number);

    return NextResponse.json({
      success: true,
      data: {
        total: orderData.length,
        found: successCount,
        notFound,
      }
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: '1688 주문 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류',
      },
      { status: 500 }
    );
  }
}
