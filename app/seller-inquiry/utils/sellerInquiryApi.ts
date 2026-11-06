import type { SellerInquiryDetail, SellerInquiryStatus } from '../../../lib/sellerInquiries';

// ============================================================
// /seller-inquiry → API 호출 (상세 조회 · 상태 변경 · 메모 줄 조작)
//   실패하면 서버 error 문구(없으면 fallback)로 SellerInquiryApiError 를 던진다
//   (status 로 409 = 다른 작업자가 먼저 바꿈 을 구분할 수 있다)
// ============================================================

/** PATCH memo_op — 메모 줄 기록 1줄 조작 (lib/memoLog). prev = 화면이 본 그 줄 원문 */
export type MemoOpInput =
  | { op: 'add'; text: string }
  | { op: 'edit'; index: number; prev: string; text: string }
  | { op: 'delete'; index: number; prev: string };

export class SellerInquiryApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SellerInquiryApiError';
  }
}

export async function fetchSellerInquiryDetail(id: string, fallbackError: string): Promise<SellerInquiryDetail> {
  const res = await fetch(`/api/ft/seller-inquiries/${id}`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || !json.success) throw new SellerInquiryApiError(json.error || fallbackError, res.status);
  return json.inquiry as SellerInquiryDetail;
}

export async function patchSellerInquiry(
  id: string,
  body: { status?: SellerInquiryStatus; memo_op?: MemoOpInput },
  fallbackError: string,
): Promise<SellerInquiryDetail> {
  const res = await fetch(`/api/ft/seller-inquiries/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new SellerInquiryApiError(json.error || fallbackError, res.status);
  return json.inquiry as SellerInquiryDetail;
}
