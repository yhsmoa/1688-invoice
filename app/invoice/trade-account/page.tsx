import PaymentHistory from '../payment-history/PaymentHistory';

// ============================================================
// 무역계좌 — 고객계좌(payment-history)와 동일 구조/기능 재사용.
//   · 현재는 동일 데이터 소스. 무역계좌 전용 데이터 분기가 필요하면
//     PaymentHistory 에 mode prop 추가로 확장.
// ============================================================
export default function TradeAccountPage() {
  return <PaymentHistory title="무역계좌" />;
}
