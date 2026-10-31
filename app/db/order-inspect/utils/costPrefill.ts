import { todayKST } from '../../../invoice/payment-history-v2/utils/customerLedger';
import type { InspectOrder } from '../types';

// ============================================================
// costPrefill — [비용처리] 모달에 미리 채울 값 (엑셀 표시값 → 입력값)
//
//   · 금액    : I열 결제금액 ("¥1,234.50" → "1234.5")
//   · 적용일  : K열 주문일시의 날짜. 못 읽거나 오늘 이후면 오늘 (서버가 미래 날짜를 거부)
//   · 내용    : 상품 1개면 상품명(번역), 여러 개면 "판매자 (N개 상품)"
//   · 비고    : 상품별 "상품명 × 수량" 목록 — 고객 차감의 "규격-수량" 비고 패턴과 맞춘다
//   · 참조키  : 1688 주문번호 기준 고정 → 같은 주문을 두 번 기록하면 두 원장 모두 서버가 차단
//               (중복 차단 전용. 기록 여부 조회는 두 원장의 order_no_1688 컬럼으로 한다)
// ============================================================

/** 내용(항목) 최대 길이 — 1688 상품명은 규격까지 붙어 매우 길다 */
const DESCRIPTION_MAX = 80;

/** 결제금액 표시값 → 숫자 입력 문자열. 숫자로 못 읽으면 '' (사용자가 직접 입력) */
export const amountInputOf = (text: string): string => {
  const n = Number(text.replace(/[^\d.-]/g, ''));
  return text && Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '';
};

/** 주문일시 표시값 → 적용일 (YYYY-MM-DD). 형식을 못 읽거나 오늘 이후면 오늘 */
export const appliedDateOf = (orderedAt: string): string => {
  const today = todayKST();
  const m = orderedAt.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return today;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return d <= today ? d : today;
};

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** 내용(항목) 기본값 */
export const descriptionOf = (o: InspectOrder): string => {
  if (o.items.length === 1) return clip(o.items[0].detailKo || o.items[0].detail, DESCRIPTION_MAX);
  if (o.items.length > 1) return clip(`${o.shop || '1688'} (${o.items.length}개 상품)`, DESCRIPTION_MAX);
  return `1688 주문 ${o.orderNo}`;
};

/** 상품별 "상품명 × 수량" 목록 (한 줄에 하나) */
export const itemLinesOf = (o: InspectOrder): string =>
  o.items.map((it) => `${it.detailKo || it.detail}${it.qty ? ` × ${it.qty}` : ''}`).join('\n');

/** 무역계좌 참조키 — ExpenseModal 의 TRADE-{구분}-{ts} 와 같은 접두어, 주문번호로 고정 */
export const tradeReferenceId = (o: InspectOrder): string => `TRADE-1688-${o.orderNo}`;

/** 고객계좌(신) 참조키 — 수동 차감의 MANUAL-차감-{ts} 와 같은 접두어, 주문번호로 고정 */
export const customerReferenceId = (o: InspectOrder): string => `MANUAL-차감-1688-${o.orderNo}`;
