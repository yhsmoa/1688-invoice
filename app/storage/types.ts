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
// 와우출고 — 줄 1개 (ft_wow_items + 와우 박스 + 마킹 상자)
//   box_id NULL = 박스 미정 (예약만, 담을 수 없다)
// ============================================================

/** 단계 — 판정은 utils/wowStage.ts (신규 → 작업중 → 작업완료 → 서류준비 → 순서지정 → 합포장 → 출고준비 → 출고) */
export type WowStage = 'new' | 'working' | 'done' | 'docs' | 'seq' | 'pack' | 'ready' | 'shipped';

/** 선반 배정 한 줄 — 저장된 값 (ft_wow_finds · supabase/storage/011_wow_alloc.sql) */
export interface WowAlloc {
  /** null = 잡을 재고가 없는 몫 */
  location_code: string | null;
  /** 그 선반에 잡아 둔 수량 (표시한 뒤에는 꺼낸 수량) */
  plan_qty: number;
  /** 모바일에서 찾았다고 표시한 수량 (null = 아직) */
  found_qty: number | null;
}

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
  /** 꺼낼 선반 — 담지 않은 박스의 줄만 (담은 뒤 · 박스 미정 줄은 빈 배열) */
  allocs: WowAlloc[];
  box_id: string | null;
  box_no: number | null;
  center: string | null;
  /** 로켓 발주서의 입고예정일 'YYYY-MM-DD' (아직 받지 못했으면 null) */
  arrival_date: string | null;
  /** 박스 크기 — 작업자가 모바일에서 바꿨으면 그 값, 아니면 로켓이 준 값 */
  box_size: string | null;
  /** 그 발주서의 박스 전체 수 (한국에서 보내는 박스 포함 — 박스 라벨 "n / 총") */
  order_box_total: number | null;
  /** 박스 라벨(발주번호-박스번호)을 뽑은 시각 (아직이면 null) */
  label_printed_at: string | null;
  /** 마킹 상자 (ft_box_info) — [출고준비완료] 때 정해진다. 마대면 여러 박스가 같은 값 */
  box_info_id: string | null;
  /** 마킹번호 (BR-X-01 …) */
  box_code: string | null;
  label_path: string | null;
  manifest_path: string | null;
  /** 작업 시작(모바일에서 박스 라벨을 찍음) 시각 · 담당자 (신규면 null) */
  work_started_at: string | null;
  work_started_by: string | null;
  /** [작업완료] 시각(박스) · 담당자 — 담지 않았으면 null */
  box_picked_at: string | null;
  picked_by: string | null;
  /** [순서지정] 으로 찍은 순서 · 시각 · 담당자 */
  ship_seq: number | null;
  ship_seq_at: string | null;
  ship_seq_by: string | null;
  /** [부착완료] 시각 · 담당자 — 서류를 다 붙여 합포장 단계로 넘어감 */
  attached_at: string | null;
  attached_by: string | null;
  /** 합포장: 정한 시각 · 담당자 · 담긴 마대 (packed_at null = 마대에 담지 않았고 마킹번호도 없음, bag_id null + packed_at 있음 = 박스 그대로 마킹번호가 붙음) */
  packed_at: string | null;
  packed_by: string | null;
  bag_id: string | null;
  bag_no: number | null;
  /** [출고준비완료] 를 누른 시각 · 담당자 (출고준비 전이면 null) */
  ready_at: string | null;
  ready_by: string | null;
  /** 이 박스의 포장 행이 전부 출고됨 */
  shipped: boolean;
  /** 출고 시각 · 쉽먼트 번호 (출고 전이면 null) */
  shipped_at: string | null;
  shipment_no: string | null;
}

// ============================================================
// 와우출고 모바일 작업 (/m/wow ↔ /api/ft/storage/wow/work)
//   카드 = (박스, 상품, 위치). 계산은 utils/wowWork.ts 한 곳
// ============================================================

/** 카드에 같이 보여 주는 그 상품의 다른 위치 */
export interface WowWorkSpare {
  location_code: string;
  qty: number;
}

export interface WowWorkCard {
  /** `${product_id}|${location_id ?? ''}` */
  key: string;
  product_id: string;
  /** null = 재고 위치가 없는 몫 (찾을 수 없다 — 부족 0 으로만 표시) */
  location_id: string | null;
  location_code: string | null;
  /** 이 카드의 몫 · 그 위치의 지금 재고
   *   표시 전: 여기서 찾을 수량. 표시한 위치 카드: 그 위치에서 꺼낸 수량(= found_qty, 0 이면 "여기엔 없음").
   *   위치 없는 카드: 부족 수량 */
  plan_qty: number;
  stock_qty: number;
  /** 찾은 수량 (null = 아직 표시 안 함). 위치 없는 카드는 표시해도 0 */
  found_qty: number | null;
  found_by: string | null;
  found_at: string | null;
  memo: string | null;
  memo_by: string | null;
  memo_at: string | null;
  /** 이 상품의 요청 수량(줄 전체) */
  line_qty: number;
  spares: WowWorkSpare[];
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  barcode: string | null;
  product_no: string | null;
}

/** 목록 한 줄 = 작업할 박스 (신규 · 작업중) */
export interface WowWorkBox {
  box_id: string;
  user_id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  arrival_date: string | null;
  box_size: string | null;
  stage: WowStage;
  work_started_by: string | null;
  /** 카드 수 · 그중 꺼냈다고 표시한 위치 카드 · 부족으로 표시한 카드(위치 없는 카드) */
  cards: number;
  found_cards: number;
  short_cards: number;
  /** 요청 수량 합 · 찾은 수량 합 */
  qty: number;
  found_qty: number;
}

export interface WowWorkDeck {
  box: WowWorkBox;
  cards: WowWorkCard[];
}
