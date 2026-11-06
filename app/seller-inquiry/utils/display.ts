import type { SellerInquiryKind, SellerInquiryStatus } from '../../../lib/sellerInquiries';

// ============================================================
// /seller-inquiry 화면 표시 공용 — 열 정의 · 칩 클래스 · 시각 표시
// ============================================================

// ── 목록 열 (머리글 순서 = 행 칸 순서) — 상세 행 colSpan 은 SELLER_INQUIRY_COLUMN_COUNT ──
export interface InquiryColumn {
  key: 'kind' | 'image' | 'delivery' | 'items' | 'arrived' | 'short' | 'expected' | 'memo' | 'status' | 'photos';
  labelKey: string;
  className?: string;
}

export const SELLER_INQUIRY_COLUMNS: readonly InquiryColumn[] = [
  { key: 'kind',     labelKey: 'sellerInquiry.colKind',      className: 'si-col-kind' },
  { key: 'image',    labelKey: 'sellerInquiry.col.image',    className: 'si-col-img' },
  { key: 'delivery', labelKey: 'sellerInquiry.col.delivery' },
  { key: 'items',    labelKey: 'sellerInquiry.col.items' },
  { key: 'arrived',  labelKey: 'sellerInquiry.col.arrived',  className: 'si-col-num' },
  { key: 'short',    labelKey: 'sellerInquiry.col.short',    className: 'si-col-num' },
  // 확인수량 = expected_qty. 구분별 뜻: 미입고 = 입고되어야 할 수량(order−cancel),
  //                                     확인요청 = 작업자가 입력한 확인수량 (short 는 항상 0)
  { key: 'expected', labelKey: 'sellerInquiry.col.expected', className: 'si-col-num' },
  { key: 'memo',     labelKey: 'sellerInquiry.col.memo',     className: 'si-col-memo' },
  { key: 'status',   labelKey: 'sellerInquiry.col.status' },
  { key: 'photos',   labelKey: 'sellerInquiry.col.photos',   className: 'si-col-photos' },
];

export const SELLER_INQUIRY_COLUMN_COUNT = SELLER_INQUIRY_COLUMNS.length;

// ── 칩 색 클래스 ──
export const STATUS_CLASS: Record<SellerInquiryStatus, string> = {
  접수: 'is-new',
  문의중: 'is-inq',
  처리완료: 'is-done',
};

export const KIND_CLASS: Record<SellerInquiryKind, string> = {
  미입고: 'is-missing',
  확인요청: 'is-check',
};

// ── 시각 표시 (월/일 시:분, KST) — 값이 없으면 – ──
export function formatShortDateTime(iso: string | null, locale: string): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(locale, {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** i18n 언어 → 날짜 표시 locale */
export const dateLocaleOf = (language: string): string => (language === 'zh' ? 'zh-CN' : 'ko-KR');
