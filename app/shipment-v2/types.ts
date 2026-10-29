// ============================================================
// 쉽먼트 V2 — 공용 타입 (ShipmentV2.tsx / components / hooks 공유)
// ============================================================

/** 고객(purchase-agent)이 남긴 미처리 이동요청 — ft_move_requests (status = REQUESTED) */
export interface MoveRequestInfo {
  id: string;
  /** 이동해 달라는 박스 타입 A/B/C/P/X */
  target_type: string;
  /** 요청 시점의 박스 (표시용 스냅샷) */
  from_box_code: string | null;
  requested_by: string | null;
  requested_at: string;
}

/**
 * GET /api/ft/shipment-v2 응답 행 (ft_fulfillment_outbounds 1행 + 조인 정보)
 *   상품 정보 출처: order_item_id → ft_order_items / manual_item_id → ft_shipment_manual_items([생성])
 */
export interface ShipmentV2Row {
  id: string;
  box_code: string;
  /** ft_box_info.id — 사이즈 수정·박스라벨 기준 */
  box_info_id: string | null;
  /** ft_box_info.size ("60x50x40") */
  box_size: string | null;
  master_box_id: string | null;
  master_box_code: string | null;
  /** 합배송이면 마스터 박스 타입, 아니면 자기 박스 타입 — 이동요청 처리 판정 기준 */
  effective_box_type: string | null;
  order_item_id: string | null;
  /** [생성] 으로 만든 부자재 행이면 ft_shipment_manual_items.id */
  manual_item_id: string | null;
  quantity: number;
  total_qty: number;
  available_qty: number;
  shipment_size: string | null;
  /** 박스 적합 판정용 A/B/C/P/X — resolveScanSizeCode(shipment_type, coupang_shipment_size) / 부자재는 입력값 */
  size_code: string | null;
  product_no: string | null;
  barcode: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  price_cny: number | null;
  img_url: string | null;
  composition: string | null;
  /** 저장값 (한글) — 편집·필터 키 */
  customs_category: string | null;
  /** 통관정보 영문명 — 표시용, 매핑 없으면 null */
  customs_category_en: string | null;
  move_request: MoveRequestInfo | null;
}

/** GET /api/ft/box-info 응답 행 (필요 필드만) — type/no 는 새 박스 번호 제안에 사용 */
export interface BoxInfoItem {
  id: string;
  box_code: string;
  size?: string | null;
  type?: string | null;
  no?: string | null;
}

/** GET /api/hr/workers 응답 행 — 처리 담당자 드롭다운 */
export interface Worker {
  id: string;
  name: string;
  name_kr: string | null;
  role: string;
}
