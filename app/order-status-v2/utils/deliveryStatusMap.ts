// ============================================================
// 배송 상태 매핑 (im_1688_orders_delivery_status 표시용)
//
// · order_status (주문 상태)   → 이모지
// · delivery_status (배송 상태) → 한글
// · 매핑 miss 시 원본 값 그대로 반환 (디버깅 용이)
// ============================================================

// ── 주문 상태 이모지 ─────────────────────────────────────
export const ORDER_STATUS_EMOJI: Record<string, string> = {
  '待发货': '📝',   // 발송 대기
  '待收货': '📦',   // 수령 대기
};

// ── 배송 상태 이모지 — 있으면 주문 상태 이모지보다 우선 ──
export const DELIVERY_STATUS_EMOJI: Record<string, string> = {
  '已签收': '✅',   // 배송완료
};

// ── 배송 상태 정의 — 한글 표시명 + 뜻(마우스 hover 툴팁) ──
interface DeliveryStatusDef {
  label: string;
  meaning: string;
}

const DELIVERY_STATUS_DEF: Record<string, DeliveryStatusDef> = {
  '部分已发货':   { label: '일부배송',         meaning: '주문 상품 중 일부만 발송됨' },
  '待发货':       { label: '배송전',           meaning: '판매자가 아직 발송하지 않음' },
  '发货超时':     { label: '처리지연',         meaning: '판매자가 약속한 발송 기한을 넘김' },
  '已发货':       { label: '송장등록',         meaning: '판매자가 송장을 등록함' },
  '已签收':       { label: '배송완료',         meaning: '물건을 받음' },
  '待收货':       { label: '운송중(서명대기)', meaning: '발송됐고 수령 확인 전' },
  '运输中':       { label: '운송중',           meaning: '택배가 이동 중' },
  '派送中':       { label: '운송중',           meaning: '택배 기사가 배달 중' },
  // ── 2026-09 수집기 개편 후 새로 들어오는 값 ──
  '已收货未到账': { label: '수령완료',         meaning: '수령 확인은 했고 판매자 정산만 남음' },
  '待揽收':       { label: '집하대기',         meaning: '송장은 나왔는데 택배 기사가 아직 안 가져감' },
  '揽收严重超时': { label: '집하지연(심각)',   meaning: '택배 집하가 심하게 늦어짐' },
  '揽收已超时':   { label: '집하지연',         meaning: '택배 집하가 늦어짐' },
  '已揽收':       { label: '집하완료',         meaning: '택배 기사가 물건을 가져감' },
  '物流异常':     { label: '물류이상',         meaning: '배송 중 문제 발생' },
  '物流停滞':     { label: '물류정체',         meaning: '배송 추적이 멈춤' },
  // 크롤러 v3 (API 방식) 에서 나올 수 있는 값
  '已揽件':       { label: '집하완료',         meaning: '택배 기사가 물건을 가져감' },
  '物流异常提醒': { label: '물류이상',         meaning: '배송 중 문제 발생' },
};

/** 배송 상태 → 한글 표시명 (기존 import 호환) */
export const DELIVERY_STATUS_KR: Record<string, string> = Object.fromEntries(
  Object.entries(DELIVERY_STATUS_DEF).map(([cn, d]) => [cn, d.label])
);

/** 배송 상태의 뜻 — 정의에 없으면 null */
export function getDeliveryStatusMeaning(status: string): string | null {
  return DELIVERY_STATUS_DEF[status]?.meaning ?? null;
}

// ============================================================
// 송장번호 → 처리 로그 모달의 delivery code 로 합치기
//
// 모달의 delivery code 는 1688_invoice_deliveryInfo_check 에서 오고,
// CSV 송장번호(tracking_no)는 같은 번호다 (실측 1,250건 중 1,232건 동일,
// 나머지 18건은 'A / B' 처럼 여러 개를 한 칸에 적은 것).
// → 기존 코드 순서를 유지한 채 CSV 번호를 쪼개서 없는 것만 뒤에 붙인다.
// ============================================================
export function mergeDeliveryCodes(existing: string[], trackingNo?: string | null): string[] {
  const out = [...existing];
  const seen = new Set(existing.map((c) => c.trim()));
  for (const code of (trackingNo ?? '').split('/').map((c) => c.trim()).filter(Boolean)) {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

// ── 배송 상태 정보 타입 (API 응답과 동일 형식) ──────────
export interface DeliveryStatusInfo {
  order_status: string;
  delivery_status: string;
  description: string;
  timestamp: string;
  /** 택배사 — 2026-09 이후 CSV 에만 있음 */
  courier?: string;
  /** 송장번호 — 2026-09 이후 CSV 에만 있음 */
  tracking_no?: string;
  /** 현재 delivery_status 가 된 시점 (ISO) — 업로드 간 비교로 이어받음 */
  status_since?: string;
  /** 현재 description(배송위치)이 된 시점 (ISO) */
  location_since?: string;
}

// ============================================================
// 발송 대기(待发货) 상세 문구 → 한글 요약
//
// 실측 패턴 (2026-09-21 CSV, 待发货 탭 61건):
//   商品准备中                              → (표시 안 함 — '배송전' 과 중복)
//   商品准备中 预计 9月21日 送达             → 9/21 도착예정
//   商品准备中 预计明日送达                  → 내일 도착예정
//   (已)超出承诺时间 3天23小时 ，平台已处罚商家 → 발송지연 3일23시간
// 알 수 없는 문구는 원문 그대로 (매핑 miss 원칙과 동일)
// ============================================================

// ── 상대 날짜 ──
const RELATIVE_DAY_KR: Record<string, string> = {
  '今日': '오늘', '今天': '오늘',
  '明日': '내일', '明天': '내일',
  '后天': '모레',
};

// ── 기간 단위 ──
const DURATION_UNIT_KR: [RegExp, string][] = [
  [/天/g, '일'],
  [/小时/g, '시간'],
  [/分钟?/g, '분'],
];

const toKrDuration = (s: string) =>
  DURATION_UNIT_KR.reduce((acc, [re, kr]) => acc.replace(re, kr), s.replace(/\s+/g, ''));

export function summarizePendingDescription(desc: string): string | null {
  const text = desc.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const date = text.match(/预计\s*(\d{1,2})月(\d{1,2})日\s*送达/);
  if (date) return `${Number(date[1])}/${Number(date[2])} 도착예정`;

  const rel = text.match(/预计\s*(今日|今天|明日|明天|后天)\s*送达/);
  if (rel) return `${RELATIVE_DAY_KR[rel[1]]} 도착예정`;

  const late = text.match(/超出承诺时间\s*([\d天小时分钟\s]+)/);
  if (late) return `발송지연 ${toKrDuration(late[1])}`;

  if (text === '商品准备中') return null;

  return text;
}

// ============================================================
// 표시 포맷 생성
//
// 규칙:
//   "{이모지} {배송상태}"
//   - 이모지: DELIVERY_STATUS_EMOJI(예: 배송완료 ✅) → 없으면 ORDER_STATUS_EMOJI(탭)
//   - lang === 'zh' : 배송상태를 원본 중국어 그대로 표시 (한글 매핑 안 함)
//   - 그 외(ko)     : 한글 매핑 적용
//   order_status === '待发货' 이고 description 이 있으면 뒤에 붙인다
//   - zh : 원문 그대로 / ko : summarizePendingDescription 요약
// ============================================================
export function formatDeliveryDisplay(info: DeliveryStatusInfo, lang: string = 'ko'): string {
  const os = DELIVERY_STATUS_EMOJI[info.delivery_status]
    ?? ORDER_STATUS_EMOJI[info.order_status]
    ?? info.order_status;
  const ds = lang === 'zh'
    ? info.delivery_status
    : (DELIVERY_STATUS_KR[info.delivery_status] ?? info.delivery_status);

  const parts = [os, ds].filter(Boolean);
  let result = parts.join(' ').trim();

  if (info.order_status === '待发货' && info.description) {
    const extra = lang === 'zh' ? info.description : summarizePendingDescription(info.description);
    if (extra) result = `${result} ${extra}`.trim();
  }

  return result;
}
