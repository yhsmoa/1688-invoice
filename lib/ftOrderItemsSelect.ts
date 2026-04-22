// ============================================================
// ft_order_items SELECT 컬럼 — 중앙 상수
//
// 테이블 화면(ItemTableRow)에 표시되는 데이터를 반환하는
// 모든 API가 동일한 SELECT를 사용해야 화면 렌더 로직이 일관되게 동작한다.
//
// 사용처 (화면 렌더용 조회):
//   - /api/ft/order-items                    (전체 조회)
//   - /api/ft/order-items/by-delivery-code   (배송번호 서버 필터)
//
// 목적이 다른 경로는 제외 (각자 별도 SELECT 관리):
//   - /api/ft/order-items/filter-counts      (집계용)
//   - /api/ft/order-items/export-xlsx        (엑셀 컬럼 매핑 전용)
//   - /api/ft/order-items/match-order-id     (1688_order_id 매칭 전용)
// ============================================================

export const FT_ORDER_ITEMS_DISPLAY_SELECT = [
  'id',
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
  'shipment_type',
  'customs_category',
  'created_at',
  'note_notice',
  'note_cn',
  'personal_order_no',
].join(', ');
