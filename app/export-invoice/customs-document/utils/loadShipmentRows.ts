import type { CustomsDocumentData } from '../types';

// ============================================================
// 쉽먼트 V2 → 통관서류 행 (통관서류 [불러오기])
//
//   고른 사업자마다 /shipment-v2 화면과 같은 데이터를 읽는다
//     GET /api/ft/shipment-v2?user_id=  — 출고준비 목록 (PACKED · 아직 출고 안 됨)
//   + POST /api/customs-document/box-sizes → 포장 행마다 실제 상자(합배송이면 마스터)의 코드·사이즈
//
//   구글 시트 열과의 대응
//     위치=상자 코드 · 주문번호=product_no · 바코드 · 상품명 · 옵션명 · 출고개수=포장 수량
//     입고개수=available_qty · 단가=price_cny(위안) · 이미지=img_url · 품목=customs_category · 혼용률=composition
// ============================================================

export interface VenderPick {
  userId: string;
  userCode: string;
  venderName: string;
}

/** 쉽먼트 V2 행 중 통관서류에 쓰는 필드 */
interface ShipmentV2Row {
  id: string;
  box_code: string | null;
  master_box_code: string | null;
  product_no: string | null;
  barcode: string | null;
  item_name: string | null;
  option_name: string | null;
  quantity: number | null;
  available_qty: number | null;
  price_cny: number | null;
  img_url: string | null;
  customs_category: string | null;
  composition: string | null;
}

export interface LoadedShipments {
  rows: CustomsDocumentData[];
  /** 품목이 '알 수 없음' 인 행 — 구글 시트 등록과 같은 기준으로 막는다 */
  unknownRows: CustomsDocumentData[];
  /** 품목이 빈 행 수 (엑셀 영문품명·HS CODE 가 비게 됨) */
  emptyCategory: number;
  /** 상자 사이즈를 못 찾은 상자 코드 */
  sizeMissingBoxes: string[];
  /** 출고준비 상품이 없던 사업자 */
  emptyVenders: string[];
}

const str = (v: unknown): string => (v == null ? '' : String(v));

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || `${res.status} 오류`);
  return json;
}

export const isUnknownCategory = (category?: string) => (category || '').includes('알 수 없음');

export async function loadShipmentRows(picks: VenderPick[]): Promise<LoadedShipments> {
  // ── 1) 사업자별 쉽먼트 V2 목록 ──
  const fetched = await Promise.all(picks.map(async (pick) => {
    try {
      const json = await getJson(`/api/ft/shipment-v2?user_id=${encodeURIComponent(pick.userId)}`);
      return { pick, rows: (json.data || []) as ShipmentV2Row[] };
    } catch (e) {
      throw new Error(`${pick.venderName}(${pick.userCode}): ${(e as Error).message}`);
    }
  }));

  // ── 2) 상자 코드·사이즈 ──
  const outboundIds = [...new Set(fetched.flatMap((f) => f.rows.map((r) => r.id)).filter(Boolean))];
  const cartons: Record<string, { carton_code: string | null; carton_size: string | null }> = outboundIds.length
    ? (await getJson('/api/customs-document/box-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fulfillment_ids: outboundIds }),
      })).data
    : {};

  // ── 3) 통관서류 행 ──
  //   상자 코드는 사업자 코드로 시작하고(BZ-A-01), 출고준비 중에는 사업자 안에서 겹치지 않는다
  const rows: CustomsDocumentData[] = [];
  const emptyVenders: string[] = [];
  for (const { pick, rows: src } of fetched) {
    const before = rows.length;
    for (const r of src) {
      const qty = Number(r.quantity) || 0;
      if (qty <= 0) continue;
      const carton = cartons[r.id];
      rows.push({
        id: r.id,
        location: carton?.carton_code || r.master_box_code || r.box_code || '미지정',
        order_number: str(r.product_no),
        barcode: str(r.barcode),
        product_name: str(r.item_name),
        option_name: str(r.option_name),
        out_quantity: String(qty),
        in_quantity: r.available_qty == null ? '' : String(r.available_qty),
        note: '',
        unit_price: r.price_cny == null ? '' : String(r.price_cny),
        image: str(r.img_url),
        item_category: str(r.customs_category).trim(),
        blend_ratio: str(r.composition),
        box_size: carton?.carton_size || '',
        vender_name: pick.venderName,
      });
    }
    if (rows.length === before) emptyVenders.push(pick.venderName);
  }

  // 상자 코드 순 (BZ-A-02 < BZ-A-10), 같은 상자 안은 주문번호 순
  rows.sort((a, b) =>
    (a.location || '').localeCompare(b.location || '', 'ko', { numeric: true }) ||
    (a.order_number || '').localeCompare(b.order_number || '', 'ko', { numeric: true }));

  const sized = new Set(rows.filter((r) => r.box_size).map((r) => r.location));
  return {
    rows,
    unknownRows: rows.filter((r) => isUnknownCategory(r.item_category)),
    emptyCategory: rows.filter((r) => !r.item_category).length,
    sizeMissingBoxes: [...new Set(rows.map((r) => r.location || ''))].filter((loc) => !sized.has(loc)),
    emptyVenders,
  };
}
