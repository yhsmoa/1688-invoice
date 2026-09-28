// ============================================================
// 쉽먼트 V2 — 공용 타입 (ShipmentV2.tsx / components 공유)
// ============================================================

/** GET /api/ft/shipment-v2 응답 행 (ft_fulfillment_outbounds 1행 + 조인 정보) */
export interface ShipmentV2Row {
  id: string;
  box_code: string;
  master_box_id: string | null;
  master_box_code: string | null;
  order_item_id: string;
  quantity: number;
  total_qty: number;
  available_qty: number;
  shipment_size: string | null;
  product_no: string | null;
  barcode: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  price_cny: number | null;
  img_url: string | null;
  composition: string | null;
  customs_category: string | null;
}

/** GET /api/ft/box-info 응답 행 (필요 필드만) */
export interface BoxInfoItem {
  id: string;
  box_code: string;
  size?: string | null;
}
