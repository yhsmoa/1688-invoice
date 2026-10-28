import { supabase } from './supabase';
import type { DeliveryInfoRow } from './deliveryInfoExcel';

// ============================================================
// 1688 주문 엑셀 → 1688_invoice_deliveryInfo_check — 계정별 교체 (DB)
//
//   업로드에 들어 있는 계정의 행만 지우고 새 행을 넣는다. 다른 계정 행은 그대로.
//   DB 함수 delivery_info_replace_accounts 한 번 = 한 트랜잭션 → 실패하면 아무것도 바뀌지 않는다.
//   (supabase/orders/002_delivery_info_buyer_account.sql)
//   파싱은 lib/deliveryInfoExcel.ts
// ============================================================

export interface AccountReplaceResult {
  account: string;
  deleted: number;
  inserted: number;
}

export interface ReplaceResult {
  deleted: number;
  inserted: number;
  accounts: AccountReplaceResult[];
}

/** DB 함수의 'delivery: ' 오류는 접두사를 떼고 던진다 (화면에 그대로 보여 줄 문구) */
export async function replaceDeliveryInfoByAccount(accounts: string[], rows: DeliveryInfoRow[]): Promise<ReplaceResult> {
  const { data, error } = await supabase.rpc('delivery_info_replace_accounts', {
    p_accounts: accounts,
    p_rows: rows,
  });
  if (error) throw new Error(error.message.replace(/^delivery:\s*/, ''));
  return data as ReplaceResult;
}
