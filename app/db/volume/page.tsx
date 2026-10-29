import DbAccessGate from '../../../component/DbAccessGate';
import VolumeManage from './VolumeManage';

export default function VolumePage() {
  return (
    <DbAccessGate scope="volume" title="물량관리">
      <VolumeManage />
    </DbAccessGate>
  );
}
