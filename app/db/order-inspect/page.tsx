import DbAccessGate from '../../../component/DbAccessGate';
import OrderInspect from './OrderInspect';

export default function OrderInspectPage() {
  return (
    <DbAccessGate>
      <OrderInspect />
    </DbAccessGate>
  );
}
