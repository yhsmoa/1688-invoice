import type { FtOrderItem } from '../hooks/useFtData';
import { resolveScanSizeCode } from '../../../lib/sizeCode';

// ============================================================
// 공통 라벨 저장 유틸 — [라벨] 버튼 + [입고]-[저장] 버튼 공용
//
// 수정 시 양쪽 모두 자동 반영됨
// ============================================================

export interface LabelSaveParams {
  /** barcode가 있는 아이템 + 수량 배열 */
  items: { item: FtOrderItem; qty: number }[];
  /** ft_users.brand */
  brand: string | null;
  /** 담당자 번호 (소현→1, 장뢰→2, 3→3) */
  operatorNo: number;
}

/**
 * 세트상품 병합 + API 호출
 * @returns { success, count, error? }
 */
export async function saveLabelData(params: LabelSaveParams): Promise<{
  success: boolean;
  count: number;
  error?: string;
}> {
  const { items, brand, operatorNo } = params;

  // ── 1) 세트상품 병합: 동일 product_no 중 max qty 1건만 ──
  const normal: typeof items = [];
  const setGroups = new Map<string, { item: FtOrderItem; qty: number }>();

  for (const entry of items) {
    const isSet = (entry.item.set_total ?? 0) > 1;
    const productNo = entry.item.product_no;

    if (isSet && productNo) {
      const existing = setGroups.get(productNo);
      if (!existing || entry.qty > existing.qty) {
        setGroups.set(productNo, entry);
      }
    } else {
      normal.push(entry);
    }
  }

  // ── 2) labelItems 구성 ──
  //   shipment_size 는 화면 배지 / 스캔 검증과 동일한 단일 소스 함수 사용:
  //     resolveScanSizeCode(shipment_type, coupang_shipment_size)
  //     - PERSONAL → 'P'
  //     - COUPANG + Small/Medium/Large → A/B/C
  //     - COUPANG (size 매칭 실패) → 'X'
  //     - DIRECT / 기타 / null → 'X'
  //   화면 표시값과 DB 저장값이 항상 일치 (이전엔 coupang_shipment_size 만 봐서 P/X 누락 발생)
  const toLabelRow = (item: FtOrderItem, qty: number) => ({
    brand: brand || null,
    item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
    barcode: item.barcode || '',
    qty,
    product_no: item.item_no || '',
    composition: item.composition || null,
    recommanded_age: item.recommanded_age || null,
    shipment_size: resolveScanSizeCode(item.shipment_type, item.coupang_shipment_size),
    operator_no: operatorNo,
  });

  const labelItems = [
    ...normal.map((e) => toLabelRow(e.item, e.qty)),
    ...Array.from(setGroups.values()).map((e) => toLabelRow(e.item, e.qty)),
  ];

  if (labelItems.length === 0) {
    return { success: false, count: 0, error: '저장할 라벨 데이터가 없습니다.' };
  }

  // ── 3) API 호출 ──
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
