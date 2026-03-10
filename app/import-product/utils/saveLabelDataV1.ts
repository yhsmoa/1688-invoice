import type { ItemData } from '../hooks/useItemData';

// ============================================================
// V1 라벨 저장 유틸 — import-product 페이지 전용
//
// ItemData(Google Sheets 기반)를 invoiceManager_label 형식으로
// 변환한 뒤 /api/save-fashion-label 호출 (Supabase 저장)
// V2 saveLabelData.ts 와 동일한 API · 동일한 테이블 사용
// ============================================================

export interface LabelSaveParamsV1 {
  /** barcode가 있는 아이템 + 수량 배열 */
  items: { item: ItemData; qty: number }[];
  /** 쿠팡 사용자명 (brand) */
  brand: string | null;
  /** 담당자 번호 (소현→1, 장뢰→2, 3→3) */
  operatorNo: number;
}

// ============================================================
// 사이즈코드 변환 (V2 saveLabelData.ts 와 동일 규칙)
// ============================================================
const toSizeCode = (size: string | null | undefined): string | null => {
  if (!size) return null;
  const lower = size.toLowerCase().trim();
  if (lower.includes('small'))  return 'A';
  if (lower.includes('medium')) return 'B';
  if (lower.includes('large'))  return 'C';
  if (lower.startsWith('p-'))   return 'P';
  if (lower.includes('direct')) return 'X';
  return size;
};

/**
 * ItemData → invoiceManager_label 형식 변환 후 Supabase 저장
 * @returns { success, count, error? }
 */
export async function saveLabelDataV1(params: LabelSaveParamsV1): Promise<{
  success: boolean;
  count: number;
  error?: string;
}> {
  const { items, brand, operatorNo } = params;

  // ── labelItems 구성: ItemData → API 요청 형식 ──
  const labelItems = items
    .filter(({ item }) => item.barcode)
    .map(({ item, qty }) => ({
      brand: brand || null,
      item_name: [item.product_name, item.product_name_sub].filter(Boolean).join(', '),
      barcode: item.barcode || '',
      qty,
      product_no: item.order_number || '',
      composition: item.fabric_blend || null,
      recommanded_age: item.recommended_age || null,
      shipment_size: toSizeCode(item.product_size),
      operator_no: operatorNo,
    }));

  if (labelItems.length === 0) {
    return { success: false, count: 0, error: '저장할 라벨 데이터가 없습니다.' };
  }

  // ── API 호출 (V2와 동일 엔드포인트) ──
  const response = await fetch('/api/save-fashion-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: labelItems, operator_no: operatorNo }),
  });

  const result = await response.json();

  if (response.ok && result.success) {
    return { success: true, count: result.count };
  }

  return {
    success: false,
    count: 0,
    error: result.error || '라벨 저장에 실패했습니다.',
  };
}
