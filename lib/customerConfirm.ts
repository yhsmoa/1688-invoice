// ============================================================
// 고객확인 (import-product-v2 [고객확인] → Notion) 공용 설정
//
// 모달(클라이언트)과 /api/notion/customer-confirm(서버)이 같은 값을 써야
// 하므로 한 곳에 둔다.
// ============================================================

/**
 * 항목(카드) 1개당 첨부 이미지 최대 장수.
 *   · 압축본 장당 ~500KB → 10장이면 항목당 ~5MB. 여러 항목을 한 번에 보내므로
 *     요청 전체 크기가 과하게 커지지 않도록 제한한다.
 *   · 서버도 같은 값으로 다시 검사한다 (클라이언트 우회 방지).
 */
export const CUSTOMER_CONFIRM_MAX_ATTACHMENTS = 10;

/** multipart 필드명 — 항목별 첨부 이미지 (같은 이름으로 여러 개 append, 순서 = 첨부 순서) */
export const customerConfirmFileField = (itemId: string): string => `file_${itemId}`;
