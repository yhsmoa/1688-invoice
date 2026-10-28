import * as XLSX from 'xlsx';

// ============================================================
// 1688 주문 엑셀 → 1688_invoice_deliveryInfo_check 행 — 파싱 (DB 없음)
//
//   1688 주문은 두 계정에서 진행하고, 주문 엑셀(주문 목록 내보내기)은 계정마다 따로 받는다.
//   행마다 계정(엑셀 C열 买家会员名)을 붙여, 저장은 "그 파일의 계정 행만" 교체한다
//   (lib/deliveryInfoUpload.ts → DB 함수 delivery_info_replace_accounts).
//
//   파싱 2종 — 같은 엑셀을 읽지만 행을 만드는 방식이 다르다 (기존 동작 그대로 유지):
//     · parseDeliveryExcel   — [1688 XLSX] (/api/upload-delivery-excel)
//         엑셀 행마다 AD열(주문정보) 줄 단위로 1행. 병합 셀은 병합 시작 값 상속.
//     · parseOrderCheckExcel — 주문 검사 (/api/upload-order-check-excel)
//         주문(A열 병합 그룹)마다 AD열 줄 단위로 1행, 송장은 그룹 전체를 줄바꿈으로 합침, 결제시각(L열) 포함.
//
//   검증 (하나라도 어긋나면 아무것도 지우지 않도록 오류를 던진다):
//     · 헤더 — A 订单编号 · C 买家会员名 · J 订单状态 · AD 买家留言 · AF 运单号 (주문 검사는 + L 订单付款时间)
//     · 계정 — 저장할 모든 행에 계정이 있어야 하고, 파일 하나에 계정은 하나
// ============================================================

/** 엑셀 열 위치 (0부터) — 1688 주문 내보내기 */
export const ORDER_EXPORT_COL = {
  ORDER_ID: 0,             // A  订单编号
  BUYER_ACCOUNT: 2,        // C  买家会员名
  SHOP: 3,                 // D  卖家公司名
  ORDER_STATUS: 9,         // J  订单状态
  ORDER_PAYMENT_TIME: 11,  // L  订单付款时间
  OFFER_ID: 24,            // Y  Offer ID
  ORDER_INFO: 29,          // AD 买家留言
  DELIVERY_CODE: 31,       // AF 运单号
} as const;

/** 헤더 검사 — 이 위치에 이 이름이 있어야 1688 주문 엑셀로 본다 (다른 파일을 올려 데이터를 지우지 않도록) */
const REQUIRED_HEADERS: Array<[number, string]> = [
  [ORDER_EXPORT_COL.ORDER_ID, '订单编号'],
  [ORDER_EXPORT_COL.BUYER_ACCOUNT, '买家会员名'],
  [ORDER_EXPORT_COL.ORDER_STATUS, '订单状态'],
  [ORDER_EXPORT_COL.ORDER_INFO, '买家留言'],
  [ORDER_EXPORT_COL.DELIVERY_CODE, '运单号'],
];

/** DB 에 넣는 행 (표 열 이름 그대로) */
export interface DeliveryInfoRow {
  id: string;
  buyer_account: string;
  order_id: string | null;
  shop: string;
  delivery_status: string | null;
  offer_id: string | null;
  order_info: string | null;
  delivery_code: string | null;
  sheet_order_number: string | null;
  sheet_order_code?: string | null;
  order_payment_time?: string | null;
}

/** 파일 하나의 파싱 결과 */
export interface ParsedDeliveryFile {
  account: string;
  rows: DeliveryInfoRow[];
  /** 저장 행이 나온 주문 수 */
  orderCount: number;
}

/** 사용자에게 그대로 보여 줄 파싱 오류 */
export class DeliveryExcelError extends Error {}

// ============================================================
// 공용 헬퍼
// ============================================================
const colLetter = (i: number) =>
  i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

/** 헤더가 맞지 않으면 DeliveryExcelError */
function assertOrderExportHeader(headerRow: unknown[] | undefined, extra: Array<[number, string]> = []): void {
  const row = headerRow ?? [];
  const missing = [...REQUIRED_HEADERS, ...extra]
    .filter(([i, name]) => str(row[i]) !== name)
    .map(([i, name]) => `${colLetter(i)}열 '${name}'`);
  if (missing.length > 0) {
    throw new DeliveryExcelError(
      `1688 주문 엑셀이 아닙니다 (헤더 불일치: ${missing.join(', ')}). 1688 주문 목록에서 내보낸 원본 파일을 올려 주세요.`
    );
  }
}

/** 계정 ID — 빈 값이면 null */
function normalizeAccount(v: unknown): string | null {
  const s = str(v);
  return s === '' ? null : s.slice(0, 100);
}

/** 파일 하나 = 계정 하나 */
function singleAccount(accounts: Set<string>): string {
  const list = Array.from(accounts);
  if (list.length === 0) throw new DeliveryExcelError('C열(买家会员名) 계정 정보가 없습니다.');
  if (list.length > 1) {
    throw new DeliveryExcelError(`파일 하나에 계정이 ${list.length}개 있습니다 (${list.join(', ')}). 계정별로 받은 엑셀을 올려 주세요.`);
  }
  return list[0];
}

function readFirstSheet(buffer: Buffer, opts: XLSX.Sheet2JSONOpts) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new DeliveryExcelError('엑셀에 시트가 없습니다.');
  const all = XLSX.utils.sheet_to_json(worksheet, { header: 1, ...opts }) as unknown[][];
  return { worksheet, header: all[0], dataRows: all.slice(1) };
}

// ============================================================
// [1688 XLSX] — 엑셀 행 × AD열 줄 단위
// ============================================================
export function parseDeliveryExcel(buffer: Buffer): ParsedDeliveryFile {
  const { worksheet, header, dataRows } = readFirstSheet(buffer, {});
  assertOrderExportHeader(header);

  // ── 병합 셀: 값이 비었을 때만 병합 시작 셀 값을 상속 (빈값과 병합을 구분) ──
  const merges: XLSX.Range[] = worksheet['!merges'] || [];
  const getMergedValue = (dataRowIndex: number, colIndex: number): unknown => {
    const actualRow = dataRowIndex + 1; // 헤더 1행 → 실제 시트 행 (0-based)
    for (const m of merges) {
      if (actualRow >= m.s.r && actualRow <= m.e.r && colIndex >= m.s.c && colIndex <= m.e.c) {
        const start = dataRows[m.s.r - 1];
        if (m.s.r - 1 >= 0 && start) return start[colIndex];
      }
    }
    return null;
  };
  const cell = (i: number, col: number): string => {
    const raw = dataRows[i]?.[col];
    return str(raw) !== '' ? str(raw) : str(getMergedValue(i, col));
  };

  const C = ORDER_EXPORT_COL;
  const rows: DeliveryInfoRow[] = [];
  const accounts = new Set<string>();
  const orderAccount = new Map<string, string>();   // 주문번호 → 계정 (병합이 아닌 파일 대비)
  const orders = new Set<string>();
  let itemCounter = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || row.length === 0) continue;

    const orderId = cell(i, C.ORDER_ID);
    const orderInfo = cell(i, C.ORDER_INFO);
    const deliveryCode = cell(i, C.DELIVERY_CODE);

    // 계정 — 그 행(병합 포함) → 같은 주문의 앞 행
    const cellAccount = normalizeAccount(cell(i, C.BUYER_ACCOUNT));
    if (cellAccount && orderId) orderAccount.set(orderId, cellAccount);
    const account = cellAccount ?? (orderId ? orderAccount.get(orderId) ?? null : null);

    // AD열과 AF열이 모두 비어 있으면 저장할 것이 없다
    if (!orderInfo && !deliveryCode) continue;
    if (!account) {
      throw new DeliveryExcelError(`${i + 2}행에 계정(C열 买家会员名)이 없습니다.`);
    }
    accounts.add(account);
    if (orderId) orders.add(orderId);

    const lines = orderInfo ? orderInfo.split('\n').filter((l) => l.trim()) : [''];
    for (const line of lines) {
      const trimmed = line.trim();

      // ── 주문정보 형식 ──
      //   새 형식    : order_code // order_number // 옵션 // 바코드 // 수량
      //   기존 형식  : order_number // 옵션 // 바코드 // 수량
      //   레거시     : MMDD - 옵션 - 바코드 - 수량
      let sheetOrderCode: string | null = null;
      let sheetOrderNumber: string | null = null;
      if (trimmed.includes('//')) {
        const parts = trimmed.split('//').map((p) => p.trim());
        if (parts.length >= 5) {
          sheetOrderCode = parts[0] || null;
          sheetOrderNumber = parts[1] || null;
        } else {
          sheetOrderNumber = parts[0] || null;
        }
      } else if (trimmed.includes(' - ')) {
        sheetOrderNumber = trimmed.split(' - ').map((p) => p.trim())[0] || null;
      }

      itemCounter++;
      // id — 계정 접두사로 두 계정의 행이 겹치지 않게 (파일 안에서는 순번으로 유일)
      const localId = deliveryCode ? `${deliveryCode}-${itemCounter}` : `no-code-${itemCounter}`;
      rows.push({
        id: `${account}:${localId}`,
        buyer_account: account,
        order_id: orderId || null,
        shop: cell(i, C.SHOP),
        delivery_status: cell(i, C.ORDER_STATUS) || null,
        offer_id: cell(i, C.OFFER_ID) || null,
        order_info: trimmed || null,
        delivery_code: deliveryCode || null,
        sheet_order_code: sheetOrderCode,
        sheet_order_number: sheetOrderNumber,
      });
    }
  }

  if (rows.length === 0) {
    throw new DeliveryExcelError('AD열(주문정보) 또는 AF열(배송코드)에 데이터가 있는 유효한 행이 없습니다.');
  }
  return { account: singleAccount(accounts), rows, orderCount: orders.size };
}

// ============================================================
// 주문 검사 — 주문(A열 그룹) × AD열 줄 단위
// ============================================================

/** AD열 한 줄에서 주문번호 — "BZ-250925-0039 // 옵션 // 바코드 // 1ea" → "BZ-250925-0039", "//" 없으면 전체 */
function extractSheetOrderNumber(orderInfo: string): string {
  const t = orderInfo.trim();
  return t.includes('//') ? t.split('//')[0].trim() : t;
}

/** 엑셀 날짜·시간(숫자 또는 문자열) → ISO 문자열, 못 읽으면 null */
function parseExcelDateTime(value: unknown): string | null {
  if (!value) return null;
  try {
    if (typeof value === 'number') {
      const d = XLSX.SSF.parse_date_code(value);
      if (d) return new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0).toISOString();
    }
    if (typeof value === 'string') {
      const t = value.trim();
      if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}$/.test(t)) {
        const date = new Date(t);
        if (!isNaN(date.getTime())) return date.toISOString();
      }
      const m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(오후|오전|AM|PM)?$/i);
      if (m) {
        const [, y, mo, d, hh, mi, ss, ampm] = m;
        let h = parseInt(hh, 10);
        if (ampm && (ampm === '오후' || ampm.toUpperCase() === 'PM') && h < 12) h += 12;
        if (ampm && (ampm === '오전' || ampm.toUpperCase() === 'AM') && h === 12) h = 0;
        const date = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), h, parseInt(mi, 10), parseInt(ss, 10));
        if (!isNaN(date.getTime())) return date.toISOString();
      }
      const date = new Date(t);
      if (!isNaN(date.getTime())) return date.toISOString();
    }
    return null;
  } catch (error) {
    console.error('날짜 변환 오류:', value, error);
    return null;
  }
}

interface OrderGroup {
  orderId: string;
  account: string | null;
  firstRow: number;
  shop: string;
  deliveryStatus: string;
  orderPaymentTime: string | null;
  orderInfo: string;
  deliveryCodes: string[];
  offerIds: string[];
}

export function parseOrderCheckExcel(buffer: Buffer): ParsedDeliveryFile {
  const { header, dataRows } = readFirstSheet(buffer, { defval: '' });
  assertOrderExportHeader(header, [[ORDER_EXPORT_COL.ORDER_PAYMENT_TIME, '订单付款时间']]);

  const C = ORDER_EXPORT_COL;
  const groups: OrderGroup[] = [];
  let cur: OrderGroup | null = null;

  // ── 1단계: A열에 새 주문번호가 나오면 새 그룹, 그 아래 행은 같은 그룹 ──
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || row.length === 0) continue;

    const orderIdCell = str(row[C.ORDER_ID]);
    const orderInfo = str(row[C.ORDER_INFO]);
    const deliveryCode = str(row[C.DELIVERY_CODE]);
    const offerId = str(row[C.OFFER_ID]);

    if (orderIdCell) {
      if (cur) groups.push(cur);
      cur = {
        orderId: orderIdCell,
        account: normalizeAccount(row[C.BUYER_ACCOUNT]),
        firstRow: i,
        shop: str(row[C.SHOP]),
        deliveryStatus: str(row[C.ORDER_STATUS]),
        orderPaymentTime: parseExcelDateTime(row[C.ORDER_PAYMENT_TIME]),
        orderInfo,
        deliveryCodes: deliveryCode ? [deliveryCode] : [],
        offerIds: offerId ? [offerId] : [],
      };
    } else if (cur) {
      if (deliveryCode) cur.deliveryCodes.push(deliveryCode);
      if (offerId) cur.offerIds.push(offerId);
      // 병합 셀이면 첫 행에만 값 — 아래 행에 값이 있으면 그것으로
      if (orderInfo) cur.orderInfo = orderInfo;
    }
  }
  if (cur) groups.push(cur);

  // ── 2단계: 그룹 × AD열 줄 → 행 ──
  const rows: DeliveryInfoRow[] = [];
  const accounts = new Set<string>();
  const orders = new Set<string>();

  for (const g of groups) {
    if (!g.orderInfo) continue;
    if (!g.account) {
      throw new DeliveryExcelError(`${g.firstRow + 2}행(주문 ${g.orderId})에 계정(C열 买家会员名)이 없습니다.`);
    }
    accounts.add(g.account);
    orders.add(g.orderId);

    const deliveryCodeJoined = g.deliveryCodes.join('\n');
    g.orderInfo
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line, lineIndex) => {
        rows.push({
          id: `${g.orderId}-${lineIndex + 1}`,   // 1688 주문번호는 계정 사이에서도 유일
          buyer_account: g.account as string,
          order_id: g.orderId,
          shop: g.shop,
          delivery_status: g.deliveryStatus || null,
          order_payment_time: g.orderPaymentTime || null,
          offer_id: g.offerIds[0] || null,
          order_info: line,
          delivery_code: deliveryCodeJoined,
          sheet_order_number: extractSheetOrderNumber(line),
        });
      });
  }

  if (rows.length === 0) {
    throw new DeliveryExcelError('AD열과 AF열에 유효한 데이터가 없습니다.');
  }
  return { account: singleAccount(accounts), rows, orderCount: orders.size };
}
