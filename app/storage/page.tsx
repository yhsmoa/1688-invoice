import { redirect } from 'next/navigation';

// ============================================================
// /storage → 첫 탭 [작업중]
// ============================================================
export default function StoragePage() {
  redirect('/storage/pending');
}
