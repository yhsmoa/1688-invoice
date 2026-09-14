import PaymentHistoryV2 from './PaymentHistoryV2';

// ============================================================
// 고객계좌 (신) — 새 원장(ft_user_transactions) 읽기 전용 화면.
//   구 고객계좌(/invoice/payment-history)와 병행 운영. 데이터 변경 없음.
// ============================================================
export default function PaymentHistoryV2Page() {
  return <PaymentHistoryV2 />;
}
