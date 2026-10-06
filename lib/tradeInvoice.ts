// ============================================================
// tradeInvoice — PROFORMA INVOICE 공용 스펙 (서버·클라이언트 공용, DB 접근 없음)
//
//   원본 템플릿: assets/trade-invoice/proforma-invoice-template.xlsx (시트 '린이 치노')
//   인쇄 영역  : A1:N48
//
//   · 열 너비·행 높이·병합·테두리·문구를 이 파일 한 곳에 둔다.
//     미리보기(HTML, InvoicePreview) 와 EXCEL2(exceljs, tradeInvoiceServer) 가
//     같은 스펙으로 그리므로 화면 = JPG/PDF = EXCEL2 가 항상 일치한다.
//   · 좌표는 원본 템플릿의 셀 위치를 그대로 따른다. (A1:N48 밖의 셀 —
//     O열 안내문·49~52행 한글 주의사항 — 은 엑셀에만 들어가고 미리보기엔 없다.)
//   · 입력값은 금액 하나. 수량 = 금액 (단가 US$1.000 고정), 합계·FOB 금액은 수식.
// ============================================================

// ── 입력 ──
export interface InvoiceInput {
  /** 금액 (US$, 정수) */
  amount: number;
  /** 저장 날짜 YYYY-MM-DD (클라이언트 로컬 날짜 — 서버 시계를 쓰지 않는다) */
  date: string;
}

export const INVOICE_AMOUNT_MAX = 999_999_999;

/** YYYY-MM-DD 형식 + 실제 존재하는 날짜인지 */
export function isValidInvoiceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidInvoiceAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= INVOICE_AMOUNT_MAX;
}

// ============================================================
// 값 서식
// ============================================================

/** 인보이스 번호 — 'NO : JYT' + 저장일 YYYYMMDD */
export function makeInvoiceNo(date: string): string {
  return `NO : JYT${date.replace(/-/g, '')}`;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 엑셀 'dd-mmm-yy' 표시와 동일 (예: 06-Oct-26) */
export function fmtInvoiceDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}-${String(y % 100).padStart(2, '0')}`;
}

/** 수량 — 3자리 콤마 (예: 30,000) */
export function fmtQty(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** US$ 회계 서식의 숫자 부분 (예: 30,000.00 / 단가는 1.000) */
export function fmtUsdNumber(n: number, digits: 2 | 3 = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 엑셀 날짜 일련번호 (1900 기준, 1899-12-30 = 0) */
export function excelDateSerial(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** 엑셀 숫자 서식 — 원본 템플릿과 동일 */
export const INVOICE_NUM_FMT = {
  qty: '_ * #,##0_ ;_ * \\-#,##0_ ;_ * "-"_ ;_ @_ ',
  usd: '_-"US$"* #,##0.00_ ;_-"US$"* \\-#,##0.00\\ ;_-"US$"* "-"??_ ;_-@_ ',
  unitPrice: '_-"US$"* #,##0.000_ ;_-"US$"* \\-#,##0.000\\ ;_-"US$"* "-"???_ ;_-@_ ',
  date: 'dd-mmm-yy',
} as const;

/** 단가 — 템플릿 고정값 US$1.000 */
export const INVOICE_UNIT_PRICE = 1;

/** 저장 파일명 공통 접두어 (원본 파일명 유지) */
export function invoiceFileBase(date: string): string {
  return `PROFORMA INVOICE-LINYI JIEYUN TONG_JYT${date.replace(/-/g, '')}`;
}

// ============================================================
// 격자 — 열 너비 / 행 높이 (원본 템플릿 값)
// ============================================================

export const INVOICE_COL_COUNT = 14; // A~N
export const INVOICE_ROW_COUNT = 48; // 인쇄 영역

/** 열 너비 (엑셀 문자 단위) A..N */
export const INVOICE_COL_WIDTHS = [1.33, 6.11, 2.66, 2.66, 13.33, 4.55, 9.89, 6.78, 7.89, 7.89, 7.89, 9.33, 7.89, 7.89];

/** 행 높이 (pt) 1..48 */
export const INVOICE_ROW_HEIGHTS = [
  16.5, 40.5, 15.75, 13.5, 12.75, 16.5, 24, 17.25, 17.25, 17.25,   // 1~10
  17.25, 9, 16.5, 6, 13.5, 11.25, 16.5, 16.5, 16.5, 16.5,          // 11~20
  17.25, 18, 9, 4.5, 16.5, 16.5, 17.25, 17.25, 16.5, 17.25,        // 21~30
  16.5, 16.5, 17.25, 15, 15, 17.25, 16.5, 16.5, 17.25, 16.5,       // 31~40
  16.5, 16.5, 16.5, 16.5, 15, 16.5, 16.5, 16.5,                    // 41~48
];

/**
 * 엑셀 열 너비(문자) → 화면 px
 *   px = 문자 수 × 기본 글꼴 최대 숫자 폭 + 여백 5. 템플릿 기본 글꼴은 돋움 11pt (숫자 폭 8px).
 *   (원본이 A4 에 85% 축소로 맞춰져 있는 것과 일치한다)
 */
export const colWidthPx = (chars: number) => Math.round(chars * 8 + 5);
/** 행 높이(pt) → 화면 px */
export const rowHeightPx = (pt: number) => Math.round((pt * 4) / 3);

/** 1px = 9525 EMU (엑셀 drawing 좌표 단위) */
export const EMU_PER_PX = 9525;

/** 도장 이미지 위치 — 원본 drawing 앵커 (I40 에서 오른쪽 34px·아래 11px, 330×168px) */
export const INVOICE_STAMP = {
  col: 9, colOffsetPx: 34,
  row: 40, rowOffsetPx: 11,
  widthPx: 330, heightPx: 168,
} as const;

// ============================================================
// 테두리 — 선 목록으로 정의하고 셀별 테두리는 계산한다
//   hline: `row` 아래쪽 가로선 (cols from~to), vline: `col` 오른쪽 세로선 (rows from~to)
//   col 0 = 표 왼쪽 바깥 (A의 왼쪽 선)
// ============================================================

export type BorderStyle = 'thin' | 'medium' | 'double';

interface HLine { row: number; from: number; to: number; style: BorderStyle }
interface VLine { col: number; from: number; to: number; style: BorderStyle }

const H_LINES: HLine[] = [
  // SHIPPER / BUYER 상자 (6~11)
  { row: 5, from: 1, to: 14, style: 'medium' },
  { row: 11, from: 1, to: 14, style: 'medium' },
  // 품목 표 (15~22)
  { row: 14, from: 1, to: 14, style: 'medium' },
  { row: 16, from: 1, to: 14, style: 'thin' },
  { row: 17, from: 1, to: 14, style: 'thin' },
  { row: 18, from: 1, to: 14, style: 'thin' },
  { row: 19, from: 1, to: 14, style: 'thin' },
  { row: 20, from: 1, to: 14, style: 'thin' },
  { row: 21, from: 1, to: 14, style: 'double' },
  { row: 22, from: 1, to: 14, style: 'medium' },
  // 조건 상자(왼쪽 A~G) / 은행 상자(오른쪽 H~N) (25~39)
  { row: 24, from: 1, to: 14, style: 'medium' },
  { row: 27, from: 1, to: 7, style: 'medium' },
  { row: 28, from: 8, to: 14, style: 'medium' },
  { row: 30, from: 1, to: 7, style: 'medium' },
  { row: 33, from: 1, to: 14, style: 'medium' },
  { row: 36, from: 1, to: 7, style: 'medium' },
  { row: 39, from: 1, to: 14, style: 'medium' },
];

const V_LINES: VLine[] = [
  // 바깥 왼쪽·오른쪽
  { col: 0, from: 6, to: 11, style: 'medium' },
  { col: 14, from: 6, to: 11, style: 'medium' },
  { col: 0, from: 15, to: 22, style: 'medium' },
  { col: 14, from: 15, to: 22, style: 'medium' },
  { col: 0, from: 25, to: 39, style: 'medium' },
  { col: 14, from: 25, to: 39, style: 'medium' },
  // SHIPPER | BUYER 구분
  { col: 8, from: 6, to: 11, style: 'medium' },
  // 품목 표 내부 (Model | Item | Qty | U/Price | Amount | Rmks)
  { col: 3, from: 15, to: 22, style: 'thin' },
  { col: 6, from: 15, to: 22, style: 'thin' },
  { col: 8, from: 15, to: 22, style: 'thin' },
  { col: 10, from: 15, to: 22, style: 'thin' },
  { col: 12, from: 15, to: 22, style: 'thin' },
  // 조건 | 은행 구분
  { col: 7, from: 25, to: 39, style: 'medium' },
];

export interface CellBorders {
  top?: BorderStyle;
  bottom?: BorderStyle;
  left?: BorderStyle;
  right?: BorderStyle;
}

const hLineAt = (row: number, col: number) => H_LINES.find((l) => l.row === row && col >= l.from && col <= l.to)?.style;
const vLineAt = (col: number, row: number) => V_LINES.find((l) => l.col === col && row >= l.from && row <= l.to)?.style;

/** 범위(r1,c1)~(r2,c2) 의 바깥 테두리 — 단일 셀은 r1=r2, c1=c2 */
export function rangeBorders(r1: number, c1: number, r2: number, c2: number): CellBorders {
  return {
    top: hLineAt(r1 - 1, c1),
    bottom: hLineAt(r2, c1),
    left: vLineAt(c1 - 1, r1),
    right: vLineAt(c2, r1),
  };
}

// ============================================================
// 셀 스펙
// ============================================================

/** 값 종류 — text 외는 입력값·날짜에서 계산 (엑셀에서는 숫자·수식으로 기록) */
export type InvoiceCellKind =
  | 'text'
  | 'invoiceNo'   // K4  NO : JYT + YYYYMMDD
  | 'date'        // K5  저장일 (dd-mmm-yy)
  | 'qty'         // G17 수량 = 금액
  | 'unitPrice'   // I17 US$ 1.000
  | 'amount'      // K17 금액
  | 'total'       // K22 =SUM(K17:K21)
  | 'fobAmount'   // E26 =K22
  | 'issueDate';  // B35 =K5

export interface InvoiceFont {
  /** gothic = Century Gothic (기본), korean = 맑은 고딕 (한글 주의사항) */
  family?: 'gothic' | 'korean';
  /** pt (기본 11) */
  size?: number;
  bold?: boolean;
  /** RRGGBB */
  color?: string;
}

export interface InvoiceCellSpec {
  /** 좌상단 셀 (예: 'A2') */
  ref: string;
  /** 병합 끝 셀 (예: 'N2') — 없으면 단일 셀 */
  to?: string;
  kind?: InvoiceCellKind;
  text?: string;
  font?: InvoiceFont;
  align?: 'left' | 'center' | 'right';
  /** 배경 RRGGBB */
  fill?: string;
}

export const INVOICE_FONT_FAMILY: Record<NonNullable<InvoiceFont['family']>, string> = {
  gothic: 'Century Gothic',
  korean: '맑은 고딕',
};

/** 색 — 제목(테마 accent1), 상자 머리글(accent2 80% 밝게), 표 머리글(회색) */
export const INVOICE_COLOR = {
  title: 'E84C22',
  sectionFill: 'FFF2DA',
  headerFill: 'C0C0C0',
} as const;

const B = { bold: true };

/**
 * 셀 목록 — 원본 템플릿의 문구·위치 그대로. (개정: 텍스트가 셀 밖으로 흘러넘치던
 * 곳을 병합 셀로 묶고, 글꼴을 Century Gothic 으로 통일)
 */
export const INVOICE_CELLS: InvoiceCellSpec[] = [
  // ── 제목 / 번호 / 날짜 ──
  { ref: 'A2', to: 'N2', text: '⭐PROFORMA INVOICE⭐', font: { size: 28, bold: true, color: INVOICE_COLOR.title }, align: 'center' },
  { ref: 'K4', to: 'N4', kind: 'invoiceNo', align: 'center' },
  { ref: 'K5', to: 'N5', kind: 'date', align: 'center' },

  // ── SHIPPER / BUYER ──
  { ref: 'A6', to: 'H6', text: 'SHIPPER / EXPORTER ', font: B, fill: INVOICE_COLOR.sectionFill },
  { ref: 'I6', to: 'N6', text: 'BUYER / IMPORTER', font: B, fill: INVOICE_COLOR.sectionFill },
  { ref: 'A7', to: 'H7', text: 'LINYI JIEYUN TONG IMPORT AND EXPORT CO., LTD', font: B },
  { ref: 'A8', to: 'H8', text: '531-2 ADMINISTRATIVE SERVICE CENTER, NO.1 RENMIN ROAD, PINGSHANG', font: { size: 8 } },
  { ref: 'A9', to: 'H9', text: 'TOWN, LINGANG ECONOMIC DEVELOPMENT ZONE, LINYI CITY,', font: { size: 8 } },
  { ref: 'A10', to: 'H10', text: 'SHANDONG PROVINCE,CHINA                 TEL : 15988524818', font: { size: 8 } },
  { ref: 'A11', to: 'H11', text: 'SHIPPING COUNTRY : CHINA', font: { size: 8 } },
  { ref: 'I11', to: 'N11', text: 'DESTINATION COUNTRY : KOREA', font: { size: 8 } },

  { ref: 'A13', to: 'N13', text: 'We are pleased to issue proforma invoice as following terms and conditions.' },

  // ── 품목 표 머리글 ──
  { ref: 'A15', to: 'C16', text: 'Model', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },
  { ref: 'D15', to: 'F16', text: 'Item description', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },
  { ref: 'G15', to: 'H16', text: 'Quantity', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },
  { ref: 'I15', to: 'J16', text: 'U/Price', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },
  { ref: 'K15', to: 'L16', text: 'Amount', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },
  { ref: 'M15', to: 'N16', text: 'Rmks', font: B, align: 'center', fill: INVOICE_COLOR.headerFill },

  // ── 품목 행 (17 입력, 18~21 빈 행) ──
  { ref: 'A17', to: 'C17' },
  { ref: 'D17', to: 'F17', text: 'CLOTHING', font: { size: 10, bold: true }, align: 'center' },
  { ref: 'G17', to: 'H17', kind: 'qty', font: B },
  { ref: 'I17', to: 'J17', kind: 'unitPrice', font: B },
  { ref: 'K17', to: 'L17', kind: 'amount', font: B },
  { ref: 'M17', to: 'N17' },
  ...[18, 19, 20, 21].flatMap((r): InvoiceCellSpec[] => [
    { ref: `A${r}`, to: `C${r}` }, { ref: `D${r}`, to: `F${r}` }, { ref: `G${r}`, to: `H${r}` },
    { ref: `I${r}`, to: `J${r}` }, { ref: `K${r}`, to: `L${r}` }, { ref: `M${r}`, to: `N${r}` },
  ]),
  // ── 합계 ──
  { ref: 'A22', to: 'C22' },
  { ref: 'D22', to: 'F22', text: 'TOTAL', font: B, align: 'center' },
  { ref: 'G22', to: 'H22' },
  { ref: 'I22', to: 'J22' },
  { ref: 'K22', to: 'L22', kind: 'total', font: B },
  { ref: 'M22', to: 'N22' },

  // ── 조건 (왼쪽 상자) ──
  { ref: 'B25', to: 'G25', text: 'Amount', font: B },
  { ref: 'B26', to: 'D26', text: 'FOB KOREA ' },
  { ref: 'E26', to: 'G26', kind: 'fobAmount', font: { size: 10, bold: true } },
  { ref: 'B28', to: 'G28', text: 'Port of lading', font: B },
  { ref: 'B29', to: 'G29', text: 'Weihai China' },
  { ref: 'B31', to: 'G31', text: 'Port of discharge', font: B },
  { ref: 'B32', to: 'G32', text: 'Incheon Korea' },
  { ref: 'B34', to: 'G34', text: 'the date of issue', font: B },
  { ref: 'B35', to: 'G35', kind: 'issueDate', align: 'left' },
  { ref: 'B37', to: 'G37', text: 'TERMS OF PAYMENT : ', font: B },
  { ref: 'B38', to: 'G38', text: 'Advanced remittance' },

  // ── 은행 (오른쪽 상자) ──
  { ref: 'H25', to: 'N25', text: 'INTERMEDIARY BANK ', font: { size: 12, bold: true } },
  { ref: 'H26', to: 'N26', text: 'BANK OF AMERICA , NEW YORK BRANCH' },
  { ref: 'H27', to: 'N27', text: 'SWIFT CODE NO : BOFAUS3N' },
  { ref: 'H29', to: 'N29', text: 'BENEFICIARY BANK', font: { size: 12, bold: true } },
  { ref: 'H30', to: 'N30', text: 'CHINA CONSTRUCTION BANK, LINYI BRANCH', font: B },
  { ref: 'H31', to: 'N31', text: 'SWIFT CODE NO : PCBCCNBJSDL' },
  { ref: 'H32', to: 'N32', text: 'ADD : NO.58-1,YINQUESHAN ROAD,LINYI CITY,SHANDONG,CHINA', font: { size: 10 } },
  { ref: 'H34', to: 'N34', text: 'BENEFICIARY', font: { size: 12, bold: true } },
  { ref: 'H35', to: 'N35', text: 'NAME : LINYI JIEYUN TONG IMPORT AND EXPORT CO., LTD', font: { size: 10 } },
  { ref: 'H36', to: 'N36', text: 'A/C NO : 3705 0182 6301 0000 2692' },
  { ref: 'H37', text: 'ADD : ' },
  { ref: 'I37', to: 'N37', text: '531-2 ADMINISTRATIVE SERVICE CENTER, NO.1 RENMIN ROAD, PINGSHANG', font: { size: 9 } },
  { ref: 'I38', to: 'N38', text: 'TOWN, LINGANG ECONOMIC DEVELOPMENT ZONE, LINYI CITY,', font: { size: 9 } },
  { ref: 'I39', to: 'N39', text: 'SHANDONG PROVINCE , CHINA', font: { size: 9 } },

  // ── 서명 (도장 이미지는 I40~M48 에 겹침) ──
  { ref: 'G42', to: 'H42', text: 'Confirmed By', font: B, align: 'right' },

  // ── 인쇄 영역 밖: 한글 주의사항 (엑셀에만) ──
  { ref: 'B49', text: '1) 달러 송금하셔야 합니다. 중국돈 RMB 송금하시면 안됩니다.', font: { family: 'korean', size: 10 } },
  { ref: 'B50', text: '2) 송금인명은 본인성함을 영문으로 적지말고 회사명을 영문명으로 적어주십시요', font: { family: 'korean', size: 10 } },
  { ref: 'B51', text: '3) 수취인 성명은 가끔 은행이 입력란이 부족해서 못 적어 보내는 경우가 있는데 ', font: { family: 'korean', size: 10 } },
  { ref: 'B52', text: '   그럴경우 주소란에 못적은 나머지 적으시고 그다음부터 주소 적으시면 됩니다.(co.,LTD까지 적으셔야 들어옵니다.)', font: { family: 'korean', size: 10 } },

  // ── 인쇄 영역 밖: O열 작성 안내 (엑셀에만) ──
  { ref: 'O4', text: '<---  인보이스 번호' },
  { ref: 'O5', text: '<---  인보이스 작성일' },
  { ref: 'O7', text: '<--- 송금 회사 영문이름' },
  { ref: 'O8', text: '<--- 송금회사 영문주소' },
  { ref: 'O17', text: '<--- 품명, 수량, 단가, 총 금액 ' },
  { ref: 'O26', text: '<---중계은행명' },
  { ref: 'O27', text: '<---중계은행번호(스위프트코드)' },
  { ref: 'O30', text: '<---수취 은행명' },
  { ref: 'O31', text: '<---수취 은행번호(스위프트코드)' },
  { ref: 'O32', text: '<---수취 은행주소' },
  { ref: 'O35', text: '<---수취인성명' },
  { ref: 'O36', text: '<---수취인계좌번호' },
  { ref: 'O37', text: '<--- 수취인 주소' },
  { ref: 'P40', text: '수취국가는 중국입니다' },
];

// ============================================================
// 셀 주소 helper
// ============================================================

export interface CellRange { r1: number; c1: number; r2: number; c2: number }

/** 'K4' → { row: 4, col: 11 } */
export function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`잘못된 셀 주소: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

export function specRange(spec: InvoiceCellSpec): CellRange {
  const a = parseRef(spec.ref);
  const b = spec.to ? parseRef(spec.to) : a;
  return { r1: a.row, c1: a.col, r2: b.row, c2: b.col };
}

/** 미리보기용 표시 문자열 — kind 별 값 계산 (회계 서식은 통화·숫자를 나눠 돌려준다) */
export function resolveCellDisplay(spec: InvoiceCellSpec, input: InvoiceInput): { text: string; currency?: string } {
  switch (spec.kind ?? 'text') {
    case 'invoiceNo': return { text: makeInvoiceNo(input.date) };
    case 'date':
    case 'issueDate': return { text: fmtInvoiceDate(input.date) };
    case 'qty': return { text: fmtQty(input.amount) };
    case 'unitPrice': return { text: fmtUsdNumber(INVOICE_UNIT_PRICE, 3), currency: 'US$' };
    case 'amount':
    case 'total':
    case 'fobAmount': return { text: fmtUsdNumber(input.amount), currency: 'US$' };
    default: return { text: spec.text ?? '' };
  }
}
