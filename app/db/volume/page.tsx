import DbAccessGate from '../../../component/DbAccessGate';
import VolumeManage from './VolumeManage';

export default function VolumePage() {
  return (
    <DbAccessGate>
      <VolumeManage />
    </DbAccessGate>
  );
}
