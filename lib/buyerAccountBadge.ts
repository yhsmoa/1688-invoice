// ============================================================
// 1688 구매 계정 → 화면 배지 글자 (서버 전용)
//
//   1688 주문은 두 계정에서 진행한다. 주문 엑셀(1688_invoice_deliveryInfo_check)의
//   buyer_account(엑셀 C열 买家会员名)로 주문이 어느 계정 것인지 알 수 있다.
//   화면에는 계정 ID 대신 짧은 배지(N / Y)로 보여 준다.
//
//   설정: env BUYER_ACCOUNT_BADGES = "계정ID:배지,계정ID:배지"
//     예) BUYER_ACCOUNT_BADGES=tb4576013988:N,tb288943091457:Y
//   설정에 없는 계정은 계정 ID 를 그대로 배지로 쓴다 (설정 누락이 화면에서 드러나도록).
// ============================================================

const ENV_KEY = 'BUYER_ACCOUNT_BADGES';

// ── env 파싱 ──
function parseBadgeEnv(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(',')) {
    const idx = pair.lastIndexOf(':');
    if (idx <= 0) continue;
    const account = pair.slice(0, idx).trim();
    const badge = pair.slice(idx + 1).trim();
    if (account && badge) map.set(account, badge);
  }
  return map;
}

const BADGES = parseBadgeEnv(process.env[ENV_KEY]);

/** 계정 ID → 배지 글자 (설정에 없으면 계정 ID) */
export function buyerAccountBadge(account: string): string {
  return BADGES.get(account) ?? account;
}
