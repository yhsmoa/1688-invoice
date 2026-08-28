import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// ============================================================
// invoiceManager_transactions 사용자 식별 체계
//   user_id   : ft_users.id (UUID)        ← 기준 키
//   user_name : ft_users.username         ← 원본 보존/가독용
//   user_code : ft_users.user_code        ← 화면 표시용
//   master_id : ft_users.balance_id (UUID) ← 계좌 그룹
//   master_account 는 구 코드 호환을 위해 계속 채운다.
//
// 화면이 username 을 보내도 UUID 로 해석해 저장한다.
// ============================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FtUserRef {
  id: string;
  username: string | null;
  user_code: string | null;
  balance_id: string | null;
  master_account: string | null;
}

/** username 이든 UUID 든 받아서 ft_users 행을 찾는다 */
async function findFtUser(raw: string | null | undefined): Promise<FtUserRef | null> {
  const key = (raw ?? '').trim();
  if (!key) return null;
  const col = UUID_RE.test(key) ? 'id' : 'username';
  const { data } = await supabase
    .from('ft_users')
    .select('id, username, user_code, balance_id, master_account')
    .eq(col, key)
    .maybeSingle();
  return (data as FtUserRef) ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      user_id,
      master_account,
      order_code,
      transaction_type,
      description,
      amount,
      delivery_fee,
      service_fee,
      extra_fee,
      admin_note,
      price,
      status: inputStatus,
      date,
      '1688_order_id': order1688Id
    } = body;

    // 필수값 검증
    if (!master_account) {
      return NextResponse.json({ success: false, error: 'master_account가 필요합니다.' }, { status: 400 });
    }
    if (!transaction_type) {
      return NextResponse.json({ success: false, error: 'transaction_type이 필요합니다.' }, { status: 400 });
    }
    if (amount === undefined || amount === null) {
      return NextResponse.json({ success: false, error: '금액이 필요합니다.' }, { status: 400 });
    }

    const amountNumber = Number(amount);

    // 사용자 해석 (username / UUID 모두 허용) — 실패해도 저장은 진행
    const ftUser = await findFtUser(user_id);

    // 1. 현재 잔액 조회
    const { data: balanceData, error: balanceError } = await supabase
      .from('invoiceManager_balance')
      .select('balance')
      .eq('master_account', master_account)
      .single();

    if (balanceError) {
      return NextResponse.json({
        success: false,
        error: '현재 잔액을 조회하는데 실패했습니다.',
        details: balanceError.message
      }, { status: 500 });
    }

    const currentBalance = Number(balanceData?.balance) || 0;

    // 2. 새 잔액 계산
    let newBalance: number;
    if (transaction_type === '충전') {
      newBalance = currentBalance + amountNumber;
    } else if (transaction_type === '차감') {
      newBalance = currentBalance - amountNumber;
    } else {
      newBalance = currentBalance;
    }

    // 3. 트랜잭션 저장
    // order_code: 전달된 값 사용, 없으면 MANUAL-타입-타임스탬프 형식으로 생성
    const finalOrderCode = order_code || `MANUAL-${transaction_type}-${Date.now()}`;

    const { data: transactionData, error: transactionError } = await supabase
      .from('invoiceManager_transactions')
      .insert({
        order_code: finalOrderCode,
        // 새 체계: UUID 기준. username 이 와도 ft_users 로 해석해 저장.
        user_id: ftUser?.id ?? user_id ?? null,
        user_name: ftUser?.username ?? (UUID_RE.test(String(user_id ?? '')) ? null : user_id ?? null),
        user_code: ftUser?.user_code ?? null,
        master_id: ftUser?.balance_id ?? null,
        master_account: master_account || ftUser?.master_account || null,
        transaction_type,
        description: description || null,
        '1688_order_id': order1688Id || null,
        amount: amountNumber,
        delivery_fee: delivery_fee || null,
        service_fee: service_fee || null,
        extra_fee: extra_fee || null,
        balance_after: newBalance,
        status: inputStatus || '성공',
        admin_note: admin_note || null,
        price: price || null,
        date: date || null
      })
      .select()
      .single();

    if (transactionError) {
      return NextResponse.json({
        success: false,
        error: `트랜잭션 저장 실패: ${transactionError.message}`,
        details: transactionError
      }, { status: 500 });
    }

    // 4. 잔액 업데이트
    const { error: updateBalanceError } = await supabase
      .from('invoiceManager_balance')
      .update({ balance: newBalance })
      .eq('master_account', master_account);

    if (updateBalanceError) {
      return NextResponse.json({
        success: false,
        error: '잔액을 업데이트하는데 실패했습니다.',
        details: updateBalanceError.message
      }, { status: 500 });
    }

    // 5. 정합성 검증: balance와 balance_after 일치 확인
    const { data: verifyBalance } = await supabase
      .from('invoiceManager_balance')
      .select('balance')
      .eq('master_account', master_account)
      .single();

    const { data: lastTransaction } = await supabase
      .from('invoiceManager_transactions')
      .select('balance_after')
      .eq('id', transactionData.id)
      .single();

    const balanceMatch = Number(verifyBalance?.balance) === Number(lastTransaction?.balance_after);

    if (!balanceMatch) {
      console.error('정합성 오류: balance와 balance_after 불일치', {
        balance: verifyBalance?.balance,
        balance_after: lastTransaction?.balance_after
      });
      return NextResponse.json({
        success: false,
        error: '잔액 정합성 오류가 발생했습니다. 관리자에게 문의하세요.',
        details: {
          balance: verifyBalance?.balance,
          balance_after: lastTransaction?.balance_after
        }
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: transactionData,
      newBalance
    });

  } catch (error) {
    console.error('결제 트랜잭션 저장 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '결제 트랜잭션 저장 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
