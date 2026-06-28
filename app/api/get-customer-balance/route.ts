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
// ============================================================

const PAGE = 1000;

export async function GET(request: NextRequest) {
  try {
    const masterAccount = new URL(request.url).searchParams.get('master_account');
    if (!masterAccount) {
      return NextResponse.json(
        { success: false, error: 'master_account 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── 1) 트랜잭션 합산 (Σ충전−Σ차감) + 사업자(user_id) 수집 ──
    let txNet = 0;
    const subUsernames = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('invoiceManager_transactions')
        .select('transaction_type, amount, user_id')
        .eq('master_account', masterAccount)
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

    // ── 2) 사업자 username → ft_users.id 매핑 ──
    let refundTotal = 0;
    if (subUsernames.size > 0) {
      const { data: users, error: usersErr } = await supabase
        .from('ft_users')
        .select('id, username')
        .in('username', Array.from(subUsernames));
      if (usersErr) {
        return NextResponse.json(
          { success: false, error: 'ft_users 조회 실패', details: usersErr.message },
          { status: 500 }
        );
      }
      const ids = (users ?? []).map((u) => u.id).filter(Boolean);

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
    return NextResponse.json({ success: true, balance, txNet, refundTotal });
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
