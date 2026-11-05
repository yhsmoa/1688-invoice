// ============================================================
// 1688 판매자 문의 (미입고 접수) — 공용 상수·타입
//
//   DB (Supabase manage-item):
//     ft_seller_inquiries        접수 1건 = 배송번호 1개 (사용자별) · 상태·메모·시각
//     ft_seller_inquiry_items    부족 주문행 스냅샷
//     ft_seller_inquiry_photos   첨부 사진 (Storage 공개 버킷 seller-inquiry)
//   스키마: supabase/inquiry/001_seller_inquiries.sql
//
//   쓰는 곳:
//     상품입고 V2/V3 [미입고] 모달   → POST /api/ft/seller-inquiries
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

export interface SellerInquiryRow {
  id: string;
  user_id: string;
  team_code: string;
  delivery_code: string;
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
}

/** 상세 — 접수 + 부족 행 + 사진 */
export interface SellerInquiryDetail extends SellerInquiryRow {
  items: SellerInquiryItemRow[];
  photos: SellerInquiryPhotoRow[];
}

/** [미입고] 모달 → POST 본문의 부족 행 */
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
  expected_qty: number;
  arrived_qty: number;
  short_qty: number;
}
