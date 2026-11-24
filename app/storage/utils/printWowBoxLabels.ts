import { pickTemplate } from '../../import-product-v2/utils/printLabels';
import type { FtUser } from '../../import-product-v2/hooks/useFtData';
import { preloadTemplateAssets } from '../../../lib/labelRender';
import { accountFieldsToLabelData, type LabelData, type LabelTemplate } from '../../../lib/labelTypes';
import { getLocalPrinter, LOCAL_PRINTER_HELP } from '../../../lib/localPrinterMap';
import { printRaw, QZ_NOT_RUNNING } from '../../../lib/qzTray';
import { buildTsplBatch } from '../../../lib/tspl';
import type { WowLine } from '../types';

// ============================================================
// 와우출고 박스 라벨 즉시 출력 — 상품입고의 라벨 출력(import-product-v2/utils/printLabels.ts)과 같은 길
//
//   [라벨 설정] 의 '박스 라벨' 템플릿(label_type = 'box') → 데이터 바인딩 → TSPL → QZ Tray RAW 인쇄
//   1. 템플릿: 그 사업자 기본 → 공용 기본 → 그 사업자 첫째 → 공용 첫째 (pickTemplate — 상품 라벨과 같은 규칙)
//   2. 프린터: "이 템플릿을 이 PC 에서 어떤 프린터로 뽑을지" (lib/localPrinterMap.ts — [라벨 설정] > 프린터 탭)
//      모든 사업자의 템플릿 · 프린터를 먼저 확인하고 나서 인쇄한다 (반만 찍히는 일 방지)
//   3. 박스마다 1장 — 바코드 값(bx_order_box)은 모바일(/m/wow) · [순서지정] 이 찍는 "발주번호-박스번호"
//   바인딩 필드는 lib/labelTypes.ts 의 BOX_FIELDS 와 1:1 (로켓 immongRK_scan 박스 라벨의 po_* · bx_* 와 같은 이름)
//   양식(크기 · 글자 · 배치)은 전부 템플릿이 정한다 — 여기서는 값만 만든다
// ============================================================

/** 박스 라벨 템플릿의 대상 — 박스 라벨은 성인/키즈를 나누지 않는다 (템플릿 기본 대상) */
const BOX_AUDIENCE = 'adult' as const;

/** 인쇄할 박스 하나 — 그 박스의 줄들 (같은 박스의 WowLine) */
export interface WowBoxLabelSource {
  lines: WowLine[];
}

/** 'YYYY-MM-DD' → 'MMDD' (없으면 빈 문자열) */
const mmdd = (ymd: string | null) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  return m ? `${m[1]}${m[2]}` : '';
};

/** 박스 → 라벨 바인딩 데이터 (BOX_FIELDS 의 키와 1:1) + 그 사업자의 계정 정보(acc_*) */
export function toBoxLabelData(box: WowBoxLabelSource, user: FtUser | null): LabelData {
  const head = box.lines[0];
  const code = `${head.order_number}-${head.box_no}`;
  const arrival = mmdd(head.arrival_date);
  return {
    po_order_number: head.order_number,
    po_center: head.center ?? '',
    po_arrival_date: head.arrival_date ?? '',
    po_arrival_mmdd: arrival,
    po_box_count: head.order_box_total ?? '',
    bx_order_box: code,
    bx_order_box_date: arrival ? `${code} (${arrival})` : code,
    bx_no: head.box_no ?? '',
    bx_seq: head.order_box_total ? `${head.box_no}/${head.order_box_total}` : String(head.box_no ?? ''),
    bx_size: head.box_size ?? '',
    bx_qty: box.lines.reduce((sum, l) => sum + l.qty, 0),
    bx_item_count: new Set(box.lines.map((l) => l.product_id)).size,
    ...accountFieldsToLabelData(user),
  };
}

async function fetchBoxTemplates(): Promise<LabelTemplate[]> {
  const res = await fetch('/api/label-templates?label_type=box', { cache: 'no-store' });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '라벨 템플릿을 불러오지 못했습니다.');
  return (json.data ?? []) as LabelTemplate[];
}

/**
 * 박스 라벨을 인쇄한다. 인쇄한 장수를 돌려주고, 인쇄하지 못하면 안내 문구로 throw 한다.
 *   (템플릿 없음 · 프린터 미지정 · QZ Tray 미실행 — 어느 경우든 한 장도 찍지 않는다)
 */
export async function printWowBoxLabels(boxes: WowBoxLabelSource[], users: FtUser[]): Promise<number> {
  if (boxes.length === 0) return 0;
  const templates = await fetchBoxTemplates();

  // ── 1) 템플릿(=프린터) 단위로 묶기 — 사업자마다 템플릿이 다를 수 있다 ──
  const jobs = new Map<string, { template: LabelTemplate; rows: LabelData[] }>();
  for (const box of boxes) {
    const userId = box.lines[0].user_id;
    const template = pickTemplate(templates, userId, 'box', BOX_AUDIENCE);
    if (!template) {
      throw new Error("박스 라벨 템플릿이 없습니다.\n[라벨 설정]에서 종류가 '박스 라벨'인 템플릿을 만들어 주세요.");
    }
    const job = jobs.get(template.id) ?? { template, rows: [] };
    job.rows.push(toBoxLabelData(box, users.find((u) => u.id === userId) ?? null));
    jobs.set(template.id, job);
  }

  // ── 2) 프린터 — 전부 먼저 확인 ──
  const printers = new Map<string, string>();
  for (const { template } of jobs.values()) {
    const printer = getLocalPrinter(template.id);
    if (!printer) {
      throw new Error(`"${template.name}" 템플릿에 이 PC 의 프린터가 지정되지 않았습니다.\n${LOCAL_PRINTER_HELP}`);
    }
    printers.set(template.id, printer);
  }

  // ── 3) TSPL 생성 + QZ 인쇄 (템플릿별, 박스마다 1장) ──
  try {
    for (const { template, rows } of jobs.values()) {
      await preloadTemplateAssets(template);
      await printRaw(printers.get(template.id)!, buildTsplBatch(template, rows.map((data) => ({ data, copies: 1 }))));
    }
  } catch (error) {
    console.error('와우출고 박스 라벨 인쇄 오류:', error);
    throw new Error(error instanceof Error ? `${QZ_NOT_RUNNING}\n\n(${error.message})` : QZ_NOT_RUNNING);
  }
  return boxes.length;
}
