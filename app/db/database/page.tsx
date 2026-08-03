import DbAccessGate from '../../../component/DbAccessGate';
import DatabaseManage from './DatabaseManage';

export default function DatabasePage() {
  return (
    <DbAccessGate>
      <DatabaseManage />
    </DbAccessGate>
  );
}
