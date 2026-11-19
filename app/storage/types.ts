// ============================================================
// 재고(보관) 공용 타입 — /storage 페이지 ↔ /api/ft/storage/* 응답
//
// 수량 단위 = 상품(product_id) — 세트상품은 1세트 = 1
//   (supabase/storage/001_storage.sql 머리말 참고)
// ============================================================

// ── 상품 표시 정보 (대표 주문 행에서) ──
export interface StorageProductInfo {
  product_id: string;
  /** 사업자 (ft_users.id) — 화면은 전체를 받아 사업자 탭으로 거르고, 모달은 행의 사업자로 동작 */
  user_id: string;
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
  /** PERSONAL 로 꺼낼 때 기본값 (보존값) */
  personal_order_no: string | null;
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
  /** 출고예정 · 잔여수량 — 상품 합계 (뷰 ft_storage_available, 같은 상품의 행마다 같은 값) */
  reserved: number;
  available: number;
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

// ── 꺼낼 때 정하는 타입 (S 상품) — DB 함수 ft_storage_resolve_type 의 입력 ──
export type StorageShipmentType = 'COUPANG' | 'PERSONAL' | 'DIRECT';

export interface PickTypeInput {
  shipment_type: StorageShipmentType | null;
  coupang_shipment_size: string | null;
  personal_order_no: string | null;
}

// ── 고객 쉽먼트 요청 (ft_storage_requests) ──
export interface StorageRequest {
  id: string;
  user_id: string;
  product_id: string;
  qty: number;
  shipment_type: StorageShipmentType;
  coupang_shipment_size: string | null;
  personal_order_no: string | null;
  status: 'REQUESTED' | 'DONE' | 'CANCELLED';
  requested_by: string | null;
  requested_at: string;
  done_by: string | null;
  done_at: string | null;
  done_outbound_id: string | null;
  note: string | null;
}

// ============================================================
// 와우출고 — 줄 1개 (ft_wow_items + 와우 박스 + 묶인 1688 박스)
//   box_id NULL = 박스 미정 (예약만, 담을 수 없다)
// ============================================================

/** 단계 — 판정은 utils/wowStage.ts (신규 → 작업중 → 작업완료 → 서류준비 → 출고) */
export type WowStage = 'new' | 'working' | 'done' | 'docs' | 'shipped';

export interface WowLine extends StorageProductInfo {
  /** 이 줄이 속한 박스의 단계 (박스 미정 줄은 'new') */
  stage: WowStage;
  item_id: string;
  order_number: string;
  /** 로켓이 보낸 바코드 (상품 대표 행의 바코드와 같은 값을 trim 한 것) */
  wow_barcode: string;
  qty: number;
  picked_qty: number | null;
  picked_at: string | null;
  box_id: string | null;
  box_no: number | null;
  center: string | null;
  box_size: string | null;
  box_info_id: string | null;
  box_code: string | null;
  label_path: string | null;
  manifest_path: string | null;
  /** [작업] 을 누른 시각 · 담당자 (신규면 null) */
  work_started_at: string | null;
  work_started_by: string | null;
  /** [작업완료] 한 담당자 */
  picked_by: string | null;
  /** 묶인 1688 박스의 포장 행이 전부 출고됨 */
  shipped: boolean;
  /** 출고 시각 · 쉽먼트 번호 (출고 전이면 null) */
  shipped_at: string | null;
  shipment_no: string | null;
}
