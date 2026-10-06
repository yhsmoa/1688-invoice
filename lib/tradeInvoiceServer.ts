import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {
  EMU_PER_PX, INVOICE_CELLS, INVOICE_COL_COUNT, INVOICE_COL_WIDTHS, INVOICE_FONT_FAMILY, INVOICE_NUM_FMT,
  INVOICE_ROW_COUNT, INVOICE_ROW_HEIGHTS, INVOICE_STAMP, INVOICE_UNIT_PRICE,
  excelDateSerial, makeInvoiceNo, rangeBorders, specRange,
  type CellBorders, type InvoiceCellSpec, type InvoiceInput,
} from './tradeInvoice';

// ============================================================
// tradeInvoiceServer — PROFORMA INVOICE 엑셀 생성 (서버 전용)
//
//   [excel]  buildTemplateInvoice — 원본 템플릿 xlsx 를 zip 수준에서 열어
//            값이 들어갈 셀(K4·K5·G17·K17·K22·E26·B35)의 XML 만 바꾼다.
//            서식·병합·도장 이미지·두 번째 시트 등 나머지는 바이트 그대로 보존.
//   [EXCEL2] buildInvoiceV2 — lib/tradeInvoice 스펙으로 exceljs 가 새로 그린 개정본.
//            병합·테두리·글꼴을 정리했고 문구·이미지는 원본과 동일하게 담는다.
// ============================================================

const ASSET_DIR = path.join(process.cwd(), 'assets', 'trade-invoice');
const TEMPLATE_PATH = path.join(ASSET_DIR, 'proforma-invoice-template.xlsx');
const STAMP_PATH = path.join(ASSET_DIR, 'stamp.png');

/** 템플릿 안의 인보이스 시트 (workbook.xml 의 첫 번째 시트) */
const TEMPLATE_SHEET_XML = 'xl/worksheets/sheet1.xml';

// 템플릿은 배포 중 바뀌지 않으므로 프로세스당 한 번만 읽는다
let templateCache: Buffer | null = null;
async function readTemplate(): Promise<Buffer> {
  if (!templateCache) templateCache = await fs.readFile(TEMPLATE_PATH);
  return templateCache;
}

let stampCache: Buffer | null = null;
export async function readStampImage(): Promise<Buffer> {
  if (!stampCache) stampCache = await fs.readFile(STAMP_PATH);
  return stampCache;
}

// ============================================================
// [excel] 원본 템플릿 값 치환
// ============================================================

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * sheet XML 에서 셀 하나를 통째로 바꾼다. 기존 스타일(s="…") 은 유지.
 *   build(styleAttr) 가 새 <c> 요소 전체를 돌려준다.
 */
function replaceCell(xml: string, ref: string, build: (styleAttr: string) => string): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) throw new Error(`템플릿에 ${ref} 셀이 없습니다.`);
  const styleMatch = / s="(\d+)"/.exec(m[1]);
  const styleAttr = styleMatch ? ` s="${styleMatch[1]}"` : '';
  return xml.slice(0, m.index) + build(styleAttr) + xml.slice(m.index + m[0].length);
}

export async function buildTemplateInvoice(input: InvoiceInput): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readTemplate());
  const sheetFile = zip.file(TEMPLATE_SHEET_XML);
  if (!sheetFile) throw new Error('템플릿 시트를 찾을 수 없습니다.');
  let xml = await sheetFile.async('string');

  const serial = excelDateSerial(input.date);
  const amount = input.amount;

  // K4  인보이스 번호 (공유 문자열 → 인라인 문자열)
  xml = replaceCell(xml, 'K4', (s) => `<c r="K4"${s} t="inlineStr"><is><t>${escapeXml(makeInvoiceNo(input.date))}</t></is></c>`);
  // K5  작성일 — TODAY() 수식 대신 저장일 고정값 (다시 열어도 날짜가 바뀌지 않도록)
  xml = replaceCell(xml, 'K5', (s) => `<c r="K5"${s}><v>${serial}</v></c>`);
  // G17 수량 = 금액 (단가 US$1), K17 금액
  xml = replaceCell(xml, 'G17', (s) => `<c r="G17"${s}><v>${amount}</v></c>`);
  xml = replaceCell(xml, 'K17', (s) => `<c r="K17"${s}><v>${amount}</v></c>`);
  // K22 합계 / E26 FOB 금액 / B35 발행일 — 수식은 그대로, 캐시값만 갱신
  xml = replaceCell(xml, 'K22', (s) => `<c r="K22"${s}><f>SUM(K17:K21)</f><v>${amount}</v></c>`);
  xml = replaceCell(xml, 'E26', (s) => `<c r="E26"${s}><f>K22</f><v>${amount}</v></c>`);
  xml = replaceCell(xml, 'B35', (s) => `<c r="B35"${s}><f>K5</f><v>${serial}</v></c>`);
  zip.file(TEMPLATE_SHEET_XML, xml);

  // calcChain 은 K5 를 수식 셀로 알고 있어 그대로 두면 엑셀이 복구 메시지를 띄운다.
  // 지우면 엑셀이 열 때 다시 만든다. (관계·콘텐츠 타입 항목도 함께 제거)
  zip.remove('xl/calcChain.xml');
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (relsFile) {
    const rels = (await relsFile.async('string')).replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, '');
    zip.file('xl/_rels/workbook.xml.rels', rels);
  }
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    const ct = (await ctFile.async('string')).replace(/<Override [^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
    zip.file('[Content_Types].xml', ct);
  }
  // 열 때 전체 재계산 → 합계·발행일 수식이 새 값으로 확정
  const wbFile = zip.file('xl/workbook.xml');
  if (wbFile) {
    const wb = (await wbFile.async('string')).replace(/<calcPr ([^/]*?)\/>/, (_m, attrs: string) =>
      attrs.includes('fullCalcOnLoad') ? `<calcPr ${attrs}/>` : `<calcPr ${attrs} fullCalcOnLoad="1"/>`,
    );
    zip.file('xl/workbook.xml', wb);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ============================================================
// [EXCEL2] 개정본 — 공용 스펙으로 새로 그린다
// ============================================================

const SHEET_NAME = '린이 치노';
/** 원본 Sheet1 에 들어 있던 다른 회사 도장 이미지 4장 — 원본 앵커(0 기준 셀 + px 오프셋) 그대로 옮긴다 */
const EXTRA_SHEET_NAME = 'Sheet1';
interface ExtraImage {
  media: string;
  ext: 'png' | 'jpeg';
  col: number; colOffPx: number;
  row: number; rowOffPx: number;
  size: { width: number; height: number };
}
const EXTRA_IMAGES: ExtraImage[] = [
  { media: 'xl/media/image2.jpg', ext: 'jpeg', col: 1, colOffPx: 0, row: 5, rowOffPx: 0, size: { width: 296, height: 132 } },
  { media: 'xl/media/image3.png', ext: 'png', col: 5, colOffPx: 0, row: 7, rowOffPx: 0, size: { width: 98, height: 91 } },
  { media: 'xl/media/image4.png', ext: 'png', col: 3, colOffPx: 4, row: 18, rowOffPx: 13, size: { width: 296, height: 206 } },
  { media: 'xl/media/image5.jpg', ext: 'jpeg', col: 9, colOffPx: 25, row: 18, rowOffPx: 14, size: { width: 214, height: 212 } },
];

/** exceljs 네이티브 앵커 — 0 기준 셀 인덱스 + EMU 오프셋 (ExcelJS.Anchor 는 class 라 IAnchor 로 넘긴다) */
function nativeAnchor(col: number, colOffPx: number, row: number, rowOffPx: number): ExcelJS.Anchor {
  return {
    nativeCol: col, nativeColOff: colOffPx * EMU_PER_PX,
    nativeRow: row, nativeRowOff: rowOffPx * EMU_PER_PX,
  } as ExcelJS.Anchor;
}

const toExcelBorder = (b: CellBorders): Partial<ExcelJS.Borders> => ({
  top: b.top ? { style: b.top } : undefined,
  bottom: b.bottom ? { style: b.bottom } : undefined,
  left: b.left ? { style: b.left } : undefined,
  right: b.right ? { style: b.right } : undefined,
});

function excelFont(spec: InvoiceCellSpec): Partial<ExcelJS.Font> {
  const f = spec.font ?? {};
  return {
    name: INVOICE_FONT_FAMILY[f.family ?? 'gothic'],
    size: f.size ?? 11,
    bold: !!f.bold,
    ...(f.color ? { color: { argb: `FF${f.color}` } } : {}),
  };
}

/** kind 별 엑셀 값·서식 — 숫자·날짜는 실제 값, 합계·FOB·발행일은 수식 */
function excelValue(spec: InvoiceCellSpec, input: InvoiceInput): { value: ExcelJS.CellValue; numFmt?: string } {
  const dateValue = (() => {
    const [y, m, d] = input.date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  })();
  switch (spec.kind ?? 'text') {
    case 'invoiceNo': return { value: makeInvoiceNo(input.date) };
    case 'date': return { value: dateValue, numFmt: INVOICE_NUM_FMT.date };
    case 'qty': return { value: input.amount, numFmt: INVOICE_NUM_FMT.qty };
    case 'unitPrice': return { value: INVOICE_UNIT_PRICE, numFmt: INVOICE_NUM_FMT.unitPrice };
    case 'amount': return { value: input.amount, numFmt: INVOICE_NUM_FMT.usd };
    case 'total': return { value: { formula: 'SUM(K17:K21)', result: input.amount }, numFmt: INVOICE_NUM_FMT.usd };
    case 'fobAmount': return { value: { formula: 'K22', result: input.amount }, numFmt: INVOICE_NUM_FMT.usd };
    case 'issueDate': return { value: { formula: 'K5', result: dateValue }, numFmt: INVOICE_NUM_FMT.date };
    default: return { value: spec.text ?? null };
  }
}

export async function buildInvoiceV2(input: InvoiceInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 1,
      printArea: `A1:N${INVOICE_ROW_COUNT}`,
      horizontalCentered: true,
      margins: { left: 0.118, right: 0.157, top: 0.787, bottom: 0.394, header: 0.512, footer: 0.512 },
    },
    properties: { tabColor: { argb: 'FFFFFF00' }, defaultRowHeight: 16.5 },
  });

  // ── 격자 ──
  INVOICE_COL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  INVOICE_ROW_HEIGHTS.forEach((h, i) => { ws.getRow(i + 1).height = h; });

  // ── 셀 값·서식·병합 ──
  const covered = new Set<string>();
  for (const spec of INVOICE_CELLS) {
    const { r1, c1, r2, c2 } = specRange(spec);
    if (spec.to) ws.mergeCells(r1, c1, r2, c2);
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) covered.add(`${r}:${c}`);

    const cell = ws.getCell(r1, c1);
    const { value, numFmt } = excelValue(spec, input);
    cell.value = value;
    if (numFmt) cell.numFmt = numFmt;
    cell.font = excelFont(spec);
    // 문구 셀은 '셀에 맞춤' — 병합 폭보다 긴 주소 줄이 옆 칸(O열 안내문)에 잘리지 않도록
    cell.alignment = {
      vertical: 'middle',
      ...(spec.align ? { horizontal: spec.align } : {}),
      ...((spec.kind ?? 'text') === 'text' ? { shrinkToFit: true } : {}),
    };
    if (spec.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${spec.fill}` } };
    // 병합 범위는 좌상단 셀의 테두리가 범위 전체 바깥선이 된다
    cell.border = toExcelBorder(rangeBorders(r1, c1, r2, c2));
  }

  // ── 스펙에 없는 셀의 테두리 (상자 안 빈 칸) ──
  for (let r = 1; r <= INVOICE_ROW_COUNT; r++) {
    for (let c = 1; c <= INVOICE_COL_COUNT; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const b = rangeBorders(r, c, r, c);
      if (b.top || b.bottom || b.left || b.right) ws.getCell(r, c).border = toExcelBorder(b);
    }
  }

  // ── 도장 이미지 (원본과 같은 위치·크기) ──
  //    exceljs 의 소수 col/row 는 EMU 환산이 부정확하므로 네이티브 앵커(셀 + EMU 오프셋)로 넣는다
  const stampId = wb.addImage({ buffer: await readStampImage(), extension: 'png' });
  ws.addImage(stampId, {
    tl: nativeAnchor(INVOICE_STAMP.col - 1, INVOICE_STAMP.colOffsetPx, INVOICE_STAMP.row - 1, INVOICE_STAMP.rowOffsetPx),
    ext: { width: INVOICE_STAMP.widthPx, height: INVOICE_STAMP.heightPx },
    editAs: 'oneCell',
  });

  // ── 두 번째 시트: 원본의 다른 회사 도장 이미지 보존 ──
  const extra = wb.addWorksheet(EXTRA_SHEET_NAME, { views: [{ showGridLines: false }], properties: { defaultRowHeight: 13.5 } });
  const zip = await JSZip.loadAsync(await readTemplate());
  for (const img of EXTRA_IMAGES) {
    const file = zip.file(img.media);
    if (!file) continue;
    const id = wb.addImage({ buffer: await file.async('nodebuffer'), extension: img.ext });
    extra.addImage(id, { tl: nativeAnchor(img.col, img.colOffPx, img.row, img.rowOffPx), ext: img.size, editAs: 'oneCell' });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
