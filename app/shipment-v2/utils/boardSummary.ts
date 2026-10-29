// ============================================================
// 쉽먼트 V2 — 상단 카드 보드 집계
//
//   타입별 [박스 수 · 상품 행 수] + 미처리 이동요청 수
//   · 박스 = box_info_id (없으면 box_code) 고유값
//   · 타입 = 행이 담긴 박스의 타입 (합배송된 하위 박스도 자기 타입으로 센다)
//   · A/B/C/P/X 가 아닌 박스(코드 형식 이상)는 '전체' 에만 포함
// ============================================================
import type { ShipmentV2Row } from '../types';
import { SHIPMENT_SIZE_CODES, getBoxType, type ShipmentSizeCode } from './shipmentCodes';

export interface BoardCount {
  boxes: number;
  rows: number;
}

export interface BoardSummary {
  all: BoardCount;
  byType: Record<ShipmentSizeCode, BoardCount>;
  /** 미처리 이동요청이 걸린 행 수 */
  requests: number;
}

const boxKeyOf = (row: ShipmentV2Row): string => row.box_info_id || `code:${row.box_code || ''}`;

const isSizeCode = (v: string): v is ShipmentSizeCode =>
  (SHIPMENT_SIZE_CODES as readonly string[]).includes(v);

export function summarizeBoard(rows: ShipmentV2Row[]): BoardSummary {
  const allBoxes = new Set<string>();
  const typeBoxes = new Map<ShipmentSizeCode, Set<string>>(SHIPMENT_SIZE_CODES.map((c) => [c, new Set()]));
  const typeRows = new Map<ShipmentSizeCode, number>(SHIPMENT_SIZE_CODES.map((c) => [c, 0]));
  let requests = 0;

  for (const row of rows) {
    const key = boxKeyOf(row);
    allBoxes.add(key);
    const type = getBoxType(row.box_code || '');
    if (isSizeCode(type)) {
      typeBoxes.get(type)!.add(key);
      typeRows.set(type, (typeRows.get(type) ?? 0) + 1);
    }
    if (row.move_request) requests += 1;
  }

  const byType = Object.fromEntries(
    SHIPMENT_SIZE_CODES.map((c) => [c, { boxes: typeBoxes.get(c)!.size, rows: typeRows.get(c) ?? 0 }])
  ) as Record<ShipmentSizeCode, BoardCount>;

  return { all: { boxes: allBoxes.size, rows: rows.length }, byType, requests };
}
