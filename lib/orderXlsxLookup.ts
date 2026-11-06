import { supabase } from './supabase';
import { buyerAccountBadge } from './buyerAccountBadge';

// ============================================================
// 1688 주문ID → [1688 XLSX](1688_invoice_deliveryInfo_check) 주문 정보 (서버 전용)
//
//   · accounts : 그 주문이 들어 있는 1688 계정 (buyer_account) + 배지 글자 (N / Y)
//   · statuses : 1688 주문상태 (엑셀 J열 订单状态 — 交易关闭 · 退款中 등)
//
//   쓰는 곳:
//     POST /api/ft/1688-order-xlsx      주문상태 V2 계정 배지 · [주문누락?] 판정
//     GET  /api/ft/seller-inquiries     1688 판매자 문의 목록 배송번호 옆 계정 배지
//     GET  /api/ft/seller-inquiries/[id] 상세 부족 행 계정 배지
//
//   규칙:
//     · .in() 필터는 500개씩 청크
//     · 페이지네이션 루프 (1000행 limit 우회) — 주문 1건이 엑셀 여러 행일 수 있다
//     · 주문 1건이 두 계정 엑셀에 모두 있으면 둘 다 반환 (계정 ID 순)
//     · 주문상태는 주문 단위 값이라 보통 1개 (엑셀 행끼리 다르면 모두, 가나다순)
//     · 배지 글자는 env BUYER_ACCOUNT_BADGES (lib/buyerAccountBadge)
//     · 엑셀에 없는 주문은 결과에 없음
// ============================================================

const XLSX_TABLE = '1688_invoice_deliveryInfo_check';
const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

export interface OrderXlsxAccount {
  account: string;
  badge: string;
}

export interface OrderXlsxInfo {
  accounts: OrderXlsxAccount[];
  statuses: string[];
}

interface XlsxRow {
  order_id: string | null;
  buyer_account: string;
  delivery_status: string | null;
}

// ── 입력 정리 — 문자열만, trim, 빈 값 제외, 중복 제거 ──
export function uniqueOrderIds(values: readonly unknown[]): string[] {
  return Array.from(new Set(
    values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
  ));
}

// ============================================================
// 조회
// ============================================================
export async function lookupOrderXlsx(orderIds: readonly unknown[]): Promise<Record<string, OrderXlsxInfo>> {
  const ids = uniqueOrderIds(orderIds);
  const result: Record<string, OrderXlsxInfo> = {};
  if (ids.length === 0) return result;

  // ── 청크별 조회 → 주문별 계정 · 상태 모으기 ──
  const byOrder = new Map<string, { accounts: Set<string>; statuses: Set<string> }>();

  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);

    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from(XLSX_TABLE)
        .select('order_id, buyer_account, delivery_status')
        .in('order_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data as XlsxRow[]) {
        if (!row.order_id) continue;
        const entry = byOrder.get(row.order_id) ?? { accounts: new Set<string>(), statuses: new Set<string>() };
        entry.accounts.add(row.buyer_account);
        const status = row.delivery_status?.trim();
        if (status) entry.statuses.add(status);
        byOrder.set(row.order_id, entry);
      }

      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // ── 결과 ──
  byOrder.forEach((entry, orderId) => {
    result[orderId] = {
      accounts: Array.from(entry.accounts)
        .sort()
        .map((account) => ({ account, badge: buyerAccountBadge(account) })),
      statuses: Array.from(entry.statuses).sort(),
    };
  });
  return result;
}

// ── 주문ID 묶음 → 배지 글자 (중복 제외, 가나다순) ──
export function badgesForOrders(orderIds: readonly string[], info: Record<string, OrderXlsxInfo>): string[] {
  const set = new Set<string>();
  for (const id of orderIds) for (const a of info[id]?.accounts ?? []) set.add(a.badge);
  return Array.from(set).sort();
}
