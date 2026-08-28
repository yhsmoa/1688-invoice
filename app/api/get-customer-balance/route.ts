import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// ============================================================
// GET /api/get-customer-balance?master_account=...
//
// 고객계좌(payment-history) 잔액 — 참조 페이지(purchase-agent) 사이드바 잔액과 동일 공식.
//
//   잔액 = 트랜잭션(Σ충전 − Σ차감)  +  완료 환불(ft_cancel_details status='DONE')
//
//   · 트랜잭션: invoiceManager_transactions WHERE master_account = X
//   · 사업자(sub) = 그 트랜잭션들의 distinct user_id
//   · 환불: ft_users.username(=user_id) → ft_users.id → ft_cancel_details.user_id
//           AND status='DONE' 의 total_price_cny 합
//   · 1000행 limit 대응 — 모든 조회 페이지네이션 (CLAUDE.md §5)
//
// 검증(immong): tx_net(-31,494.53) + refund_done(76,218.46) = 44,723.93 (참조와 일치)
//
// 결제조건(payment_type) — invoiceManager_balance 계좌 단위 속성
//   PREPAID (선불)  : 충전 후 차감 → 잔액이 양수인 것이 정상
//   POSTPAID(후불)  : 차감 누적 후 정산 → 잔액이 음수(미정산액)인 것이 정상
//   컬럼 미존재/미설정 시 PREPAID 로 간주 (기존 동작 유지)
// ============================================================

const PAGE = 1000;

type PaymentType = 'PREPAID' | 'POSTPAID';

/**
 * 계좌의 결제조건 조회.
 * payment_type 컬럼이 아직 없는 환경에서도 깨지지 않도록 select('*') 후 optional 접근.
 */
async function fetchPaymentType(masterAccount: string): Promise<PaymentType> {
  const { data, error } = await supabase
    .from('invoiceManager_balance')
    .select('*')
    .eq('master_account', masterAccount)
    .maybeSingle();

  if (error || !data) return 'PREPAID';
  const raw = (data as Record<string, unknown>).payment_type;
  return raw === 'POSTPAID' ? 'POSTPAID' : 'PREPAID';
}

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    // 계좌 식별 — master_id(UUID) 우선, 없으면 master_account(문자열, 구 방식)
    const masterId = params.get('master_id');
    const masterAccount = params.get('master_account');

    if (!masterId && !masterAccount) {
      return NextResponse.json(
        { success: false, error: 'master_id 또는 master_account 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // 트랜잭션·잔액 조회에 사용할 필터 컬럼
    const acctCol = masterId ? 'master_id' : 'master_account';
    const acctVal = masterId ?? (masterAccount as string);

    // ── 1) 트랜잭션 합산 (Σ충전−Σ차감) + 사업자(user_id) 수집 ──
    let txNet = 0;
    const subUsernames = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('invoiceManager_transactions')
        .select('transaction_type, amount, user_id')
        .eq(acctCol, acctVal)
        .range(from, from + PAGE - 1);
      if (error) {
        return NextResponse.json(
          { success: false, error: '트랜잭션 조회 실패', details: error.message },
          { status: 500 }
        );
      }
      const chunk = data ?? [];
      for (const tx of chunk) {
        const amt = tx.amount || 0;
        if (tx.transaction_type === '충전') txNet += amt;
        else if (tx.transaction_type === '차감') txNet -= amt;
        if (tx.user_id) subUsernames.add(tx.user_id);
      }
      if (chunk.length < PAGE) break;
      from += PAGE;
    }

    // ── 2) 사업자 식별자 → ft_users.id 매핑 ──
    //   invoiceManager_transactions.user_id 는 ft_users.id(UUID) 로 이관됐으나,
    //   과거 데이터에는 username 문자열이 남아 있을 수 있어 양쪽 모두 처리한다.
    let refundTotal = 0;
    if (subUsernames.size > 0) {
      const raw = Array.from(subUsernames);
      const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

      const ids = raw.filter(isUuid);                 // 이미 ft_users.id
      const names = raw.filter((v) => !isUuid(v));    // 구 데이터(username)

      if (names.length > 0) {
        const { data: users, error: usersErr } = await supabase
          .from('ft_users')
          .select('id, username')
          .in('username', names);
        if (usersErr) {
          return NextResponse.json(
            { success: false, error: 'ft_users 조회 실패', details: usersErr.message },
            { status: 500 }
          );
        }
        for (const u of users ?? []) if (u.id) ids.push(u.id);
      }

      // ── 3) ft_cancel_details (status='DONE') total_price_cny 합산 (페이지네이션) ──
      if (ids.length > 0) {
        let rFrom = 0;
        while (true) {
          const { data, error } = await supabase
            .from('ft_cancel_details')
            .select('total_price_cny')
            .in('user_id', ids)
            .eq('status', 'DONE')
            .range(rFrom, rFrom + PAGE - 1);
          if (error) {
            return NextResponse.json(
              { success: false, error: '환불(ft_cancel_details) 조회 실패', details: error.message },
              { status: 500 }
            );
          }
          const chunk = data ?? [];
          for (const cd of chunk) refundTotal += cd.total_price_cny ?? 0;
          if (chunk.length < PAGE) break;
          rFrom += PAGE;
        }
      }
    }

    const balance = txNet + refundTotal;
    // 결제조건은 invoiceManager_balance(master_account 키) 에 있으므로,
    // master_id 로 호출된 경우 ft_users 에서 계좌명을 역추적한다.
    let acctName = masterAccount;
    if (!acctName && masterId) {
      const { data: u } = await supabase
        .from('ft_users')
        .select('master_account')
        .or(`master_id.eq.${masterId},balance_id.eq.${masterId}`)
        .limit(1)
        .maybeSingle();
      acctName = (u as { master_account?: string } | null)?.master_account ?? null;
    }
    const paymentType = acctName ? await fetchPaymentType(acctName) : 'PREPAID';
    return NextResponse.json({ success: true, balance, txNet, refundTotal, paymentType });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: '잔액 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : '알 수 없는 오류',
      },
      { status: 500 }
    );
  }
}
