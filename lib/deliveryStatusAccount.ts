import { supabase } from './supabase';

// ============================================================
// 배송상황 CSV → im_1688_orders_delivery_status — 계정 판정 + 계정별 교체 (DB)
//
//   배송상황 콘솔 스크립트는 로그인한 1688 계정의 주문목록만 긁는다. CSV 에는 계정 열이 없다.
//   → CSV 주문번호를 1688 주문 엑셀 표(1688_invoice_deliveryInfo_check.buyer_account)와
//     맞춰 보고 계정을 정한다. 두 계정 엑셀에 같은 주문이 함께 있는 경우는 없어,
//     매칭되는 주문 몇 건이면 계정이 하나로 나온다.
//
//   판정 규칙 (하나라도 어긋나면 DeliveryStatusAccountError — 아무것도 지우기 전):
//     · 한 계정 엑셀에만 있는 주문만 근거로 쓴다 (양쪽에 있는 주문은 무시)
//     · 근거 주문이 0건 → 거부 (그 계정의 1688 XLSX 를 먼저 올려야 함)
//     · 근거 주문이 두 계정 이상 → 거부 (한 계정으로 긁은 파일이 아님)
//     · 엑셀에 아직 없는 주문(최근 주문)은 판정된 계정으로 함께 저장
//
//   교체는 DB 함수 delivery_status_replace_account 한 번 = 한 트랜잭션
//   (supabase/delivery/003_delivery_status_buyer_account.sql)
// ============================================================

const IN_CHUNK_SIZE = 500;
const PAGE = 1000;

/** 사용자에게 그대로 보여 줄 판정·교체 오류 */
export class DeliveryStatusAccountError extends Error {}

export interface AccountResolution {
  account: string;
  /** 엑셀과 맞춰 본 근거 주문 수 */
  matchedOrders: number;
  /** CSV 의 주문 수 (중복 제외) */
  totalOrders: number;
}

export interface AccountReplaceResult {
  account: string;
  deleted: number;
  inserted: number;
}

// ============================================================
// 계정 판정
// ============================================================
export async function resolveDeliveryStatusAccount(orderNos: string[]): Promise<AccountResolution> {
  const uniqueNos = Array.from(new Set(orderNos.map((v) => v.trim()).filter((v) => v.length > 0)));

  // ── 주문번호 → 그 주문이 들어 있는 계정들 (청크 + 페이지네이션) ──
  const accountsByOrder = new Map<string, Set<string>>();
  for (let i = 0; i < uniqueNos.length; i += IN_CHUNK_SIZE) {
    const chunk = uniqueNos.slice(i, i + IN_CHUNK_SIZE);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('1688_invoice_deliveryInfo_check')
        .select('order_id, buyer_account')
        .in('order_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data as Array<{ order_id: string | null; buyer_account: string }>) {
        if (!row.order_id) continue;
        const set = accountsByOrder.get(row.order_id) ?? new Set<string>();
        set.add(row.buyer_account);
        accountsByOrder.set(row.order_id, set);
      }

      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // ── 한 계정에만 있는 주문으로 계정별 근거 수 ──
  const evidence = new Map<string, number>();
  accountsByOrder.forEach((accounts) => {
    if (accounts.size !== 1) return;
    const account = accounts.values().next().value as string;
    evidence.set(account, (evidence.get(account) ?? 0) + 1);
  });

  if (evidence.size === 0) {
    throw new DeliveryStatusAccountError(
      `1688 XLSX 에 있는 주문이 하나도 없어 어느 계정의 배송상황인지 알 수 없습니다 (주문 ${uniqueNos.length}건). ` +
        '이 계정의 1688 XLSX 를 먼저 올린 뒤 다시 올려 주세요. 기존 데이터는 그대로 유지했습니다.'
    );
  }
  if (evidence.size > 1) {
    const detail = Array.from(evidence.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([account, n]) => `${account} ${n}건`)
      .join(', ');
    throw new DeliveryStatusAccountError(
      `두 계정의 주문이 섞여 있습니다 (${detail}). 한 계정으로 로그인해 다시 수집해 주세요. 기존 데이터는 그대로 유지했습니다.`
    );
  }

  const [[account, matchedOrders]] = Array.from(evidence.entries());
  return { account, matchedOrders, totalOrders: uniqueNos.length };
}

// ============================================================
// 계정별 교체 — DB 함수의 'delivery_status: ' 오류는 접두사를 떼고 던진다
// ============================================================
export async function replaceDeliveryStatusByAccount<T extends { buyer_account: string }>(
  account: string,
  rows: T[]
): Promise<AccountReplaceResult> {
  const { data, error } = await supabase.rpc('delivery_status_replace_account', {
    p_account: account,
    p_rows: rows,
  });
  if (error) throw new Error(error.message.replace(/^delivery_status:\s*/, ''));
  return data as AccountReplaceResult;
}
