import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../../lib/supabase';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/shipment-v2/manual
//
//   쉽먼트 V2 [생성] — 주문 없는 쉽먼트 행(부자재 등) 추가
//   DB 함수 ft_shipment_manual_create 가 한 트랜잭션으로
//     ft_shipment_manual_items 1행 + ft_fulfillment_outbounds(PACKED) 1행 을 만든다.
//   (supabase/shipment/003_manual_shipment_item.sql — 가짜 주문 항목을 만들지 않는 이유 포함)
//
// Body: {
//   user_id, box_info_id,
//   product_no, barcode?, item_name, china_option?, price_cny?, customs_category?,
//   size_code: 'A'|'B'|'C'|'P'|'X', arrival_qty, scan_qty, operator_name?
// }
// Response: { success, data?: { manual_item_id, outbound_id, box_code }, error? }
//
//   1차 검증은 여기서(명확한 400), 최종 검증은 DB 함수가 박스 잠금과 함께 다시 수행.
// ============================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIZE_CODES = ['A', 'B', 'C', 'P', 'X'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

const fail = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

/** DB 함수 예외 'manual: …' → 화면 문구 */
const toManualErrorMessage = (raw: string | undefined): string | null => {
  if (!raw) return null;
  const idx = raw.indexOf('manual:');
  return idx >= 0 ? raw.slice(idx + 'manual:'.length).trim() : null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail('요청 형식이 올바르지 않습니다.');

    // ── 1) 입력 검증 ──
    const userId = str(body.user_id);
    const boxInfoId = str(body.box_info_id);
    const productNo = str(body.product_no);
    const itemName = str(body.item_name);
    const sizeCode = str(body.size_code).toUpperCase();
    const priceRaw = body.price_cny;

    if (!UUID_RE.test(userId)) return fail('사용자를 선택해 주세요.');
    if (!UUID_RE.test(boxInfoId)) return fail('박스를 선택해 주세요.');
    if (!productNo) return fail('주문번호를 입력해 주세요.');
    if (!itemName) return fail('상품정보를 입력해 주세요.');
    if (!SIZE_CODES.includes(sizeCode)) return fail('쉽먼트사이즈를 선택해 주세요.');
    if (!isPositiveInt(body.arrival_qty)) return fail('입고 수량은 1 이상의 정수여야 합니다.');
    if (!isPositiveInt(body.scan_qty)) return fail('스캔 수량은 1 이상의 정수여야 합니다.');
    if (body.scan_qty > body.arrival_qty) return fail('스캔 수량은 입고 수량보다 많을 수 없습니다.');

    let price: number | null = null;
    if (priceRaw !== undefined && priceRaw !== null && priceRaw !== '') {
      if (typeof priceRaw !== 'number' || !Number.isFinite(priceRaw) || priceRaw < 0) {
        return fail('단가는 0 이상의 숫자여야 합니다.');
      }
      price = priceRaw;
    }

    // ── 2) DB 함수 (한 트랜잭션) ──
    const { data, error } = await supabase.rpc('ft_shipment_manual_create', {
      p_user_id: userId,
      p_box_info_id: boxInfoId,
      p_item: {
        product_no: productNo,
        barcode: str(body.barcode),
        item_name: itemName,
        china_option: str(body.china_option),
        price_cny: price === null ? '' : String(price),
        customs_category: str(body.customs_category),
        size_code: sizeCode,
      },
      p_arrival: body.arrival_qty,
      p_scan: body.scan_qty,
      p_operator_name: str(body.operator_name) || null,
    });

    if (error) {
      const message = toManualErrorMessage(error.message);
      if (message) return fail(message, 409);
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('shipment-v2 manual 생성 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: '쉽먼트 행 생성 중 오류가 발생했습니다.',
        details: (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
