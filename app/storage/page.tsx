import { redirect } from 'next/navigation';

// ============================================================
// /storage → 첫 탭 [재고]
// ============================================================
export default function StoragePage() {
  redirect('/storage/stock');
}
