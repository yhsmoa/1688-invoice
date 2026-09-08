import type { FtOrderItem } from '../hooks/useFtData';
import { resolveScanSizeCode } from '../../../lib/sizeCode';
import { buildTsplBatch } from '../../../lib/tspl';
import { preloadTemplateAssets } from '../../../lib/labelRender';
import { printRaw, QZ_NOT_RUNNING } from '../../../lib/qzTray';
import type { LabelTemplate, LabelType, LabelData, LabelPrinterMap } from '../../../lib/labelTypes';

// ============================================================
// 라벨 즉시 출력 — [라벨] 모달에서 QZ Tray 로 바로 인쇄
//
// 흐름 (설계 05):
//   1. 세트상품 병합 (saveLabelData 와 동일 규칙)
//   2. 템플릿 결정 — (사용자 + 종류 + is_default) → 공용 기본 → 없으면 안내
//   3. 프린터 결정 — PC-NO + 종류 → label_printers
//   4. 항목별 데이터 바인딩 → TSPL → QZ RAW (qty 만큼 장수)
//   5. label_print_logs 기록
//
// 인쇄 실패가 입고/라벨 저장을 막지 않도록, 호출 측에서 결과만 안내한다.
// ============================================================

export interface PrintLabelParams {
  items: { item: FtOrderItem; qty: number }[];
  /** ft_users.id — 사용자별 템플릿 선택용 */
  userId: string | null;
  /** ft_users.brand — 라벨 brand 필드 */
  brand: string | null;
  /** PC-NO (작업 자리) = operator_no */
  stationNo: number;
  labelType: LabelType;
  /** 기록용 담당자 */
  printedBy?: string | null;
}

export interface PrintLabelResult {
  success: boolean;
  printed: number;
  error?: string;
}

/** 세트상품 병합 — 동일 product_no 중 최대 qty 1건만 (saveLabelData 와 동일) */
function mergeSets(items: { item: FtOrderItem; qty: number }[]) {
  const normal: typeof items = [];
  const setGroups = new Map<string, { item: FtOrderItem; qty: number }>();

  for (const entry of items) {
    const isSet = (entry.item.set_total ?? 0) > 1;
    const productNo = entry.item.product_no;
    if (isSet && productNo) {
      const existing = setGroups.get(productNo);
      if (!existing || entry.qty > existing.qty) setGroups.set(productNo, entry);
    } else {
      normal.push(entry);
    }
  }
  return [...normal, ...Array.from(setGroups.values())];
}

/** 항목 → 라벨 바인딩 데이터 (saveLabelData 의 toLabelRow 와 같은 필드) */
function toLabelData(item: FtOrderItem, qty: number, brand: string | null): LabelData {
  return {
    brand: brand || null,
    item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
    barcode: item.barcode || '',
    product_no: item.item_no || '',
    shipment_size: resolveScanSizeCode(item.shipment_type, item.coupang_shipment_size),
    composition: item.composition || null,
    recommanded_age: item.recommanded_age || null,
    qty,
  };
}

/** (사용자 + 종류) 기본 템플릿 결정 — 사용자 기본 → 공용 기본 → 사용자 첫째 → 공용 첫째 */
export function pickTemplate(
  templates: LabelTemplate[],
  userId: string | null,
  labelType: LabelType
): LabelTemplate | null {
  const byType = templates.filter((t) => t.label_type === labelType);
  return (
    byType.find((t) => t.is_default && t.user_id === userId) ??
    byType.find((t) => t.is_default && t.user_id === null) ??
    byType.find((t) => t.user_id === userId) ??
    byType.find((t) => t.user_id === null) ??
    null
  );
}

export async function printLabels(params: PrintLabelParams): Promise<PrintLabelResult> {
  const { items, userId, brand, stationNo, labelType, printedBy } = params;

  if (items.length === 0) {
    return { success: false, printed: 0, error: '출력할 항목이 없습니다.' };
  }

  try {
    // ── 1) 템플릿 ──
    const tplRes = await fetch(
      `/api/label-templates?label_type=${labelType}${userId ? `&user_id=${userId}` : ''}`
    );
    const tplJson = await tplRes.json();
    if (!tplJson.success) throw new Error(tplJson.error || '템플릿 조회 실패');

    const template = pickTemplate(tplJson.data as LabelTemplate[], userId, labelType);
    if (!template) {
      return {
        success: false,
        printed: 0,
        error: `사용할 ${labelType === 'care' ? '케어라벨' : '바코드'} 템플릿이 없습니다.\n[라벨 설정]에서 템플릿을 만들고 기본으로 지정해주세요.`,
      };
    }

    // ── 2) 프린터 ──
    const prnRes = await fetch(`/api/label-printers?station_no=${stationNo}`);
    const prnJson = await prnRes.json();
    if (!prnJson.success) throw new Error(prnJson.error || '프린터 매핑 조회 실패');

    const printer = (prnJson.data as LabelPrinterMap[]).find(
      (m) => m.label_type === labelType
    )?.qz_printer_name;

    if (!printer) {
      return {
        success: false,
        printed: 0,
        error: `PC-NO ${stationNo}에 ${labelType === 'care' ? '케어라벨' : '바코드'} 프린터가 지정되지 않았습니다.\n[라벨 설정] > 프린터 매핑에서 지정해주세요.`,
      };
    }

    // ── 3) 세트 병합 + 데이터 바인딩 ──
    const merged = mergeSets(items);
    const rows = merged.map(({ item, qty }) => ({
      data: toLabelData(item, qty, brand),
      copies: qty,
    }));

    // ── 4) TSPL 생성 + QZ 인쇄 ──
    await preloadTemplateAssets(template); // 이미지(세탁 기호)가 빠진 채 나가지 않게
    const bytes = buildTsplBatch(template, rows);
    await printRaw(printer, bytes);

    // ── 5) 기록 (실패해도 인쇄 성공은 유지) ──
    try {
      await fetch('/api/label-print-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: merged.map(({ item, qty }) => ({
            template_id: template.id,
            order_item_id: item.id,
            barcode: item.barcode,
            item_name: [item.item_name, item.option_name].filter(Boolean).join(', '),
            qty,
            station_no: stationNo,
            label_type: labelType,
            printed_by: printedBy ?? null,
          })),
        }),
      });
    } catch (logErr) {
      console.error('인쇄 기록 저장 실패(무시):', logErr);
    }

    const totalSheets = merged.reduce((n, r) => n + r.qty, 0);
    return { success: true, printed: totalSheets };
  } catch (error) {
    console.error('라벨 인쇄 오류:', error);
    return {
      success: false,
      printed: 0,
      error: error instanceof Error ? `${QZ_NOT_RUNNING}\n\n(${error.message})` : QZ_NOT_RUNNING,
    };
  }
}
