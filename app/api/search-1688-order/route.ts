import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// ============================================================
// POST /api/search-1688-order
//
// order_number (쿠팡) → 1688 플랫폼 order_id 매핑 후 DB 업데이트
//
// 매칭 방식:
//   1) 쿠팡 order_number 정규화 (# 제거 + C\d+ 접미사 제거)
//      예: "BZ-260225-0006-A01C1" → "BZ-260225-0006-A01"
//   2) invoiceManager_1688_orders.order_number 에 직접 IN 조회
//   3) 매칭된 행의 1688_order_id 를 invoiceManager_refundOrder.1688_order_number
//      컬럼에 업데이트
//
// 과거 1688_invoice_deliveryInfo_check.order_info 파싱 방식은
// invoiceManager_1688_orders 가 단일 진실 공급원이 된 이후 불필요해져 제거됨.
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderData } = body;

    if (!orderData || !Array.isArray(orderData) || orderData.length === 0) {
      return NextResponse.json(
        { success: false, error: 'orderData 배열이 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1. 쿠팡 order_number 정규화 ─────────────────────────────
    // item.id → 정규화된 order_number 매핑
    const normalizedMap = new Map<string, string>();

    for (const item of orderData as { id: string; order_number: string | null }[]) {
      if (!item.order_number) continue;
      const normalized = normalizeOrderNumber(item.order_number);
      if (normalized) normalizedMap.set(item.id, normalized);
    }

    if (normalizedMap.size === 0) {
      return NextResponse.json(
        { success: false, error: '조회할 주문번호가 없습니다.' },
        { status: 400 }
      );
    }

    // ── 2. invoiceManager_1688_orders 직접 조회 ─────────────────
    // 정규화된 order_number로 IN 쿼리 (배치 처리)
    const uniqueNormalized = [...new Set(normalizedMap.values())];
    const queryBatchSize = 500; // supabase IN 쿼리 안전 한도
    const lookupMap = new Map<string, string>(); // order_number → 1688_order_id

    for (let i = 0; i < uniqueNormalized.length; i += queryBatchSize) {
      const batch = uniqueNormalized.slice(i, i + queryBatchSize);

      const { data, error } = await supabase
        .from('invoiceManager_1688_orders')
        .select('order_number, "1688_order_id"')
        .in('order_number', batch);

      if (error) {
        return NextResponse.json(
          { success: false, error: '1688 주문 조회 실패', details: error.message },
          { status: 500 }
        );
      }

      // 첫 매칭 우선 — 중복 order_number가 있을 경우 가장 빠른 행의 ID 사용
      for (const row of (data || []) as { order_number: string; '1688_order_id': string | null }[]) {
        const num = row.order_number?.toString().trim();
        const id = row['1688_order_id']?.toString().trim();
        if (!num || !id) continue;
        if (!lookupMap.has(num)) {
          lookupMap.set(num, id);
        }
      }
    }

    // ── 3. invoiceManager_refundOrder 업데이트 ───────────────────
    // 매칭된 항목만 update, 매칭 실패 항목은 notFound에 기록
    const updateBatchSize = 100;
    let successCount = 0;

    for (let i = 0; i < orderData.length; i += updateBatchSize) {
      const batch = (orderData as { id: string; order_number: string | null }[]).slice(i, i + updateBatchSize);

      const updatePromises = batch.map((item) => {
        const normalized = normalizedMap.get(item.id);
        const orderId = normalized ? lookupMap.get(normalized) : null;

        if (!orderId) {
          return Promise.resolve({ data: null, error: null });
        }

        return supabase
          .from('invoiceManager_refundOrder')
          .update({
            '1688_order_number': orderId,
            updated_at: new Date().toISOString(),
          })
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

    // ── 4. 찾지 못한 목록 ────────────────────────────────────────
    const notFound = (orderData as { id: string; order_number: string | null }[])
      .filter(item => {
        const normalized = normalizedMap.get(item.id);
        return item.order_number && normalized && !lookupMap.has(normalized);
      })
      .map(item => item.order_number);

    return NextResponse.json({
      success: true,
      data: {
        total: orderData.length,
        found: successCount,
        notFound,
      },
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
