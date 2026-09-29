import DbAccessGate from '../../../component/DbAccessGate';
import TradeAccount from './TradeAccount';

// ============================================================
// 무역계좌 — 회사 통장 원장 (통장잔고 = 회사자산 + 고객 충전금)
//   회사 재무 화면이므로 DB 관리와 같은 접근 코드(역할 '기업')로 잠근다.
//   API 도 /api/trade-account/* 에서 같은 코드를 검증한다.
// ============================================================
export default function TradeAccountPage() {
  return (
    <DbAccessGate title="무역계좌">
      <TradeAccount />
    </DbAccessGate>
  );
}
