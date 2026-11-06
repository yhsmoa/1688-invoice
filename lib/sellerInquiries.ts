// ============================================================
// 1688 판매자 문의 (미입고 접수 · 확인요청) — 공용 상수·타입
//
//   DB (Supabase manage-item):
//     ft_seller_inquiries        접수 1건 = 배송번호 1개 (사용자별) · 상태·메모·시각
//     ft_seller_inquiry_items    부족 주문행 스냅샷
//     ft_seller_inquiry_photos   첨부 사진 (Storage 공개 버킷 seller-inquiry)
//   스키마: supabase/inquiry/001_seller_inquiries.sql · 002_seller_inquiry_kind.sql (구분)
//           · 003_seller_inquiry_memo_log.sql (메모 줄 기록 형식 · 확인수량 설명)
//   메모: 한 줄 = 기록 1개 `MM.DD HH:mm 내용` (KST) — lib/memoLog
//
//   쓰는 곳:
//     상품입고 V2/V3 [미입고] 모달          → POST /api/ft/seller-inquiries (kind '미입고')
//     상품입고 V2/V3 [1688 판매자 확인] 모달 → POST /api/ft/seller-inquiries (kind '확인요청')
//     창고 /seller-inquiry           → GET 목록 · GET/PATCH 상세
//     모바일 /m/seller-inquiry       → GET by-delivery-code · POST photos
// ============================================================

export const SELLER_INQUIRY_TABLES = {
  main: 'ft_seller_inquiries',
  items: 'ft_seller_inquiry_items',
  photos: 'ft_seller_inquiry_photos',
} as const;

export const SELLER_INQUIRY_BUCKET = 'seller-inquiry';

/** 상태 — DB 에는 한글 원문 저장, 화면 번역은 i18n */
export const SELLER_INQUIRY_STATUSES = ['접수', '문의중', '처리완료'] as const;
export type SellerInquiryStatus = (typeof SELLER_INQUIRY_STATUSES)[number];

export function isSellerInquiryStatus(v: unknown): v is SellerInquiryStatus {
  return typeof v === 'string' && (SELLER_INQUIRY_STATUSES as readonly string[]).includes(v);
}

/**
 * 구분 — DB 에는 한글 원문 저장 (002 CHECK 제약과 같은 값), 화면 번역은 i18n
 *   미입고   : 부족 수량 접수 — 같은 사용자·배송번호의 열린 접수는 1건으로 갱신
 *   확인요청 : 선택한 글번호에 대한 판매자 확인 요청 — 요청 1번 = 접수 1건 (갱신하지 않음)
 */
export const SELLER_INQUIRY_KINDS = ['미입고', '확인요청'] as const;
export type SellerInquiryKind = (typeof SELLER_INQUIRY_KINDS)[number];
/** kind 를 보내지 않은 요청의 기본값 — 기존 [미입고] 모달·모바일 조회 호환 */
export const SELLER_INQUIRY_DEFAULT_KIND: SellerInquiryKind = '미입고';

export function isSellerInquiryKind(v: unknown): v is SellerInquiryKind {
  return typeof v === 'string' && (SELLER_INQUIRY_KINDS as readonly string[]).includes(v);
}

/**
 * 허용 전이 — 앞으로만 가되, 처리완료는 문의중으로 되돌릴 수 있다 (실수로 닫았을 때)
 *   접수 → 문의중 · 접수 → 처리완료 · 문의중 → 처리완료 · 처리완료 → 문의중
 */
export const SELLER_INQUIRY_TRANSITIONS: Record<SellerInquiryStatus, readonly SellerInquiryStatus[]> = {
  접수: ['문의중', '처리완료'],
  문의중: ['처리완료'],
  처리완료: ['문의중'],
};

/** 목록 페이지 크기 */
export const SELLER_INQUIRY_PAGE_SIZE = 50;
/** 한 번에 올릴 수 있는 사진 수 */
export const SELLER_INQUIRY_MAX_PHOTOS = 10;
/** 목록 [사진] 칸에 보이는 썸네일 수 (나머지는 +n) */
export const SELLER_INQUIRY_LIST_PHOTOS = 3;

export interface SellerInquiryRow {
  id: string;
  user_id: string;
  team_code: string;
  delivery_code: string;
  kind: SellerInquiryKind;
  status: SellerInquiryStatus;
  memo: string | null;
  received_at: string;
  inquiring_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerInquiryItemRow {
  id: string;
  inquiry_id: string;
  order_item_id: string | null;
  order_no: string | null;
  item_no: string | null;
  product_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  site_url: string | null;
  order_id_1688: string | null;
  expected_qty: number;
  arrived_qty: number;
  short_qty: number;
  created_at: string;
}

export interface SellerInquiryPhotoRow {
  id: string;
  inquiry_id: string;
  storage_path: string;
  public_url: string;
  taken_by: string | null;
  created_at: string;
}

/** 목록 행 — 접수 + 부족 행 집계 */
export interface SellerInquiryListRow extends SellerInquiryRow {
  item_count: number;
  first_item_no: string | null;
  first_img_url: string | null;
  expected_total: number;
  arrived_total: number;
  short_total: number;
  photo_count: number;
  /** 부족 행들의 1688 주문ID (중복·빈 값 제외) */
  order_ids_1688: string[];
  /** 그 주문들의 1688 구매 계정 배지 (N / Y …, 중복 제외) */
  account_badges: string[];
  /** 먼저 올린 사진 공개 URL (최대 SELLER_INQUIRY_LIST_PHOTOS 장) */
  photo_urls: string[];
}

/** 목록 GET 의 탭 건수 — 상태 건수는 구분 필터를, 구분 건수는 상태 필터를 반영한다 */
export interface SellerInquiryCounts {
  status: Record<SellerInquiryStatus, number>;
  kind: Record<SellerInquiryKind, number>;
}

/** 상세 부족 행 — 창고 상세 조회([id] GET)만 1688 계정 배지를 붙인다 */
export interface SellerInquiryDetailItem extends SellerInquiryItemRow {
  account_badges?: string[];
}

/** 상세 — 접수 + 부족 행 + 사진 */
export interface SellerInquiryDetail extends SellerInquiryRow {
  items: SellerInquiryDetailItem[];
  photos: SellerInquiryPhotoRow[];
}

/** [미입고] · [1688 판매자 확인] 모달 → POST 본문의 주문행 */
export interface SellerInquiryItemInput {
  order_item_id: string;
  order_no: string | null;
  item_no: string | null;
  product_no: string | null;
  item_name: string | null;
  option_name: string | null;
  china_option1: string | null;
  china_option2: string | null;
  img_url: string | null;
  site_url: string | null;
  order_id_1688: string | null;
  /** 확인수량 — 미입고: 입고되어야 할 수량(order−cancel) · 확인요청: 작업자 입력 (1 이상) */
  expected_qty: number;
  arrived_qty: number;
  /** 미입고: expected − arrived (> 0) · 확인요청: 0 */
  short_qty: number;
}
