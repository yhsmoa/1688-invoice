// ============================================================
// 재고(보관) 공용 타입 — /storage 페이지 ↔ /api/ft/storage/* 응답
//
// 수량 단위 = 상품(product_id) — 세트상품은 1세트 = 1
//   (supabase/storage/001_storage.sql 머리말 참고)
// ============================================================

// ── 상품 표시 정보 (대표 주문 행에서) ──
export interface StorageProductInfo {
  product_id: string;
  /** 대표 주문 행 — 세트면 구성품 중 set_seq 가 가장 앞선 행 */
  order_item_id: string;
  product_no: string | null;
  item_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  barcode: string | null;
  offer_id: string | null;
  shipment_type: string | null;
  coupang_shipment_size: string | null;
  set_total: number | null;
  status: string | null;
}

// ============================================================
// [작업중] — 입고 줄 (미배치 > 0 인 줄만)
// ============================================================
export interface PendingRow extends StorageProductInfo {
  /** 이 줄을 만든 입고 행 (ft_fulfillment_inbounds.id) */
  inbound_id: string;
  arrived_at: string;
  arrival_operator: string | null;
  /** 이 입고로 늘어난 수량 (세트면 완성 세트 수) */
  line_qty: number;
  line_unplaced: number;
}

// ============================================================
// [재고] — 상품 × 위치
// ============================================================
export interface StockRow extends StorageProductInfo {
  location_id: string;
  location_code: string;
  qty: number;
  first_putaway_at: string | null;
  last_moved_at: string | null;
}

// ── 추천 위치 (같은 바코드 → 같은 offer_id) ──
export interface LocationSuggestion {
  location_id: string;
  location_code: string;
  qty: number;
  reason: 'barcode' | 'offer';
}

// ── 원장 (상세 타임라인) ──
export type MovementKind = 'PUTAWAY' | 'PICK' | 'UNPACK' | 'MOVE_OUT' | 'MOVE_IN' | 'ADJUST';

export interface LedgerRow {
  id: string;
  created_at: string;
  kind: MovementKind;
  quantity: number;
  delta: number;
  location_code: string;
  operator_name: string | null;
  note: string | null;
  outbound_box_code: string | null;
}

// ── 피킹 입력 (위치별 수량) ──
export interface PickInput {
  location_id: string;
  qty: number;
}
