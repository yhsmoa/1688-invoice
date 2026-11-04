import AccountInfo from './AccountInfo';

// ============================================================
// 계좌정보 — 접근 코드 없이 누구나 사용 (운영 요청)
//   주문 검사·무역계좌와 달리 DbAccessGate 를 쓰지 않는다.
// ============================================================
export default function AccountInfoPage() {
  return <AccountInfo />;
}
