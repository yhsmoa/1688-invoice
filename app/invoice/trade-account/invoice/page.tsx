import DbAccessGate from '../../../../component/DbAccessGate';
import TradeInvoice from './TradeInvoice';

// ============================================================
// 무역계좌 > invoice — PROFORMA INVOICE 생성 (엑셀 / JPG / PDF)
//   무역계좌와 같은 회사 재무 화면이므로 같은 접근 코드(역할 '기업')로 잠근다.
//   API 도 /api/trade-invoice/* 에서 같은 코드를 검증한다.
// ============================================================
export default function TradeInvoicePage() {
  return (
    <DbAccessGate title="Invoice">
      <TradeInvoice />
    </DbAccessGate>
  );
}
