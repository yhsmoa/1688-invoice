import DbAccessGate from '../../../component/DbAccessGate';
import OrderDataManage from './OrderDataManage';

export default function OrdersPage() {
  return (
    <DbAccessGate>
      <OrderDataManage />
    </DbAccessGate>
  );
}
