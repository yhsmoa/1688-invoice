// ============================================================
// ft_order_items SELECT 컬럼 — 중앙 상수
//
// 테이블 화면(ItemTableRow)에 표시되는 데이터를 반환하는
// 모든 API가 동일한 SELECT를 사용해야 화면 렌더 로직이 일관되게 동작한다.
//
// 사용처 (화면 렌더용 조회):
//   - /api/ft/order-items                    (전체 조회 — RPC ft_order_items_by_user → pickDisplayColumns)
//   - /api/ft/order-items/by-delivery-code   (배송번호 서버 필터 — RPC ft_order_items_by_delivery_code → pickDisplayColumns)
//   - /api/ft/order-items/by-product-ids · lookup (PostgREST select 문자열)
//
// 목적이 다른 경로는 제외 (각자 별도 SELECT 관리):
//   - /api/ft/order-items/export-xlsx        (엑셀 컬럼 매핑 전용)
//   - /api/ft/order-items/match-order-id     (1688_order_id 매칭 전용)
// ============================================================

export const FT_ORDER_ITEMS_DISPLAY_COLUMNS: readonly string[] = [
  'id',
  // user_id — 상품입고 V3 저장 시 "선택한 사용자 ≠ 주문 사용자" 차단에 쓴다
  //   (by-delivery-code 는 사용자 필터가 없어서 다른 사용자의 행이 섞일 수 있다)
  'user_id',
  'order_no',
  'item_no',
  'item_name',
  'option_name',
  'order_qty',
  'barcode',
  'china_option1',
  'china_option2',
  'price_cny',
  'price_total_cny',
  'img_url',
  'coupang_shipment_size',
  'status',
  'composition',
  'recommanded_age',
  'set_total',
  'set_seq',
  'product_no',
  'product_id',
  'site_url',
  '1688_order_id',
  '1688_offer_id',
  'shipment_type',
  // 입고 후 경로 (SHIPMENT / STOCK) — 타입 배지 옆 [S] 칩, 상품출고 V2 목록 제외 판단
  'arrival_route',
  'customs_category',
  'created_at',
  'note_notice',
  'note_cn',
  'personal_order_no',
  // ── 라벨 바인딩 전용 (lib/labelTypes.ts PRODUCT_FIELDS) — 화면 표시엔 안 쓰지만
  //    입고·라벨 모달에서 QR/텍스트에 넣을 수 있게 같이 내려준다 ──
  'note_kr',
  'kc',
  'kc_type',
  'vendor_option_id',
  'price_krw',
  'price_total_krw',
  'price_delivery_cny',
  'price_delivery_kr',
  'item_seq',
  'arrival_qty',
  'shipped_qty',
  'cancel_qty',
  'requested_date',
];

export const FT_ORDER_ITEMS_DISPLAY_SELECT = FT_ORDER_ITEMS_DISPLAY_COLUMNS.join(', ');

/**
 * RPC(ft_order_items_by_user · by_delivery_code) 가 돌려준 전체 컬럼 행에서 화면용 컬럼만 남긴다.
 * PostgREST select 와 똑같이, 행에 없는 컬럼은 키 자체를 만들지 않는다.
 * (DB 에서 컬럼을 고르면 25,000행 기준 3초가 더 걸려 여기서 한다 — supabase/perf/001)
 */
export function pickDisplayColumns(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of FT_ORDER_ITEMS_DISPLAY_COLUMNS) {
      if (col in row) out[col] = row[col];
    }
    return out;
  });
}
