import DbAccessGate from '../../../component/DbAccessGate';
import AccountInfo from './AccountInfo';

// ============================================================
// 계좌정보 — 계좌번호가 들어가는 민감 정보이므로 DB 관리와 같은 접근 코드로 잠근다.
//   API(/api/db/account-info)도 같은 코드를 매 요청 검증한다.
// ============================================================
export default function AccountInfoPage() {
  return (
    <DbAccessGate title="계좌정보">
      <AccountInfo />
    </DbAccessGate>
  );
}
