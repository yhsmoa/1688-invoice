import * as XLSX from 'xlsx';

// ============================================================
// deductParser — 1688 주문 내보내기 엑셀 → 차감 계산 (서버 전용, 순수 함수)
//
//   auto-1688-order/deductParser.js 를 그대로 옮긴 것. 두 프로젝트의 차감 규칙이
//   달라지면 같은 주문이 다른 금액으로 기록되므로, 규칙을 바꿀 때는 양쪽을 함께 바꾼다.
//
//   · 열 정의 (0-based):
//       A(0)  订单编号  1688 주문번호 (병합셀 — 주문 단위)
//       G(6)  运费      배송비
//       I(8)  实付款    실결제
//       U(20) 数量      수량
//       AD(29) 买家留言 "ORxx | ..." → 첫 토큰이 주문코드
//   · 병합셀: 값은 병합 시작 셀에서 읽고, 합산은 병합 첫 행에서만
//   · 계산 (소수 2자리 반올림):
//       delivery_fee = ΣG
//       price        = ΣI − delivery_fee
//       service_fee  = price × SERVICE_FEE_RATE
//       amount       = delivery_fee + price + service_fee
//   · 검증: 주문코드 1개만 허용 / 코드 형식 / 코드의 user_code 가 선택 유저와 일치
//           / 배송비·상품가 ≥ 0, 차감액 > 0, 수량 > 0
//   · 원본의 "현재 주문목록 대조" 는 이 프로젝트에선 ft_orders 조회로 대신한다 (호출 측).
// ============================================================

// ── 열 인덱스 / 수수료율 ──
export const COL = { A_ORDER_NO: 0, G_DELIVERY: 6, I_PAID: 8, U_QTY: 20, AD_MEMO: 29 } as const;
export const SERVICE_FEE_RATE = 0.06;

// ── 주문코드 형식: OR{user_code}{YYMMDD}-... (예: ORBZ260902-O23) ──
export const ORDER_CODE_RE = /^OR([A-Z]+)(\d{6})-/;

const round2 = (n: number) => Math.round(n * 100) / 100;
const toNum = (v: unknown) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
const toInt = (v: unknown) => parseInt(String(v ?? '').replace(/,/g, ''), 10) || 0;

/** 사용자에게 그대로 보여줄 메시지를 담는 파싱 오류 */
export class DeductParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeductParseError';
  }
}

export interface DeductCalc {
  orderCode: string;
  orderNos1688: string[];
  delivery_fee: number;
  price: number;
  service_fee: number;
  amount: number;
  item_qty: number;
  rowCount: number;
}

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

// ── 병합셀: 현재 셀이 비어있으면 병합 시작 셀 값 ──
function getMergedValue(rowIdx: number, colIdx: number, data: Row[], merges: XLSX.Range[]): Cell {
  const direct = data[rowIdx]?.[colIdx];
  if (direct !== undefined && direct !== '') return direct;
  for (const merge of merges) {
    if (rowIdx >= merge.s.r && rowIdx <= merge.e.r && colIdx >= merge.s.c && colIdx <= merge.e.c) {
      const v = data[merge.s.r]?.[merge.s.c];
      if (v !== undefined) return v;
    }
  }
  return '';
}

// ── 병합셀의 첫 행인지 (합산은 첫 행에서만) ──
function isFirstRowOfMerge(rowIdx: number, colIdx: number, merges: XLSX.Range[]): boolean {
  for (const merge of merges) {
    if (rowIdx >= merge.s.r && rowIdx <= merge.e.r && colIdx >= merge.s.c && colIdx <= merge.e.c) {
      return rowIdx === merge.s.r;
    }
  }
  return true;
}

// ============================================================
// 워크시트 → 차감 계산 결과
// ============================================================
export function parseDeductWorksheet(
  worksheet: XLSX.WorkSheet,
  opts: { selectedUserCode?: string | null },
): DeductCalc {
  const jsonData = XLSX.utils.sheet_to_json<Row>(worksheet, { header: 1, defval: '', blankrows: false });
  if (jsonData.length < 2) throw new DeductParseError('엑셀 파일에 데이터가 없습니다.');
  const merges: XLSX.Range[] = worksheet['!merges'] || [];

  // ── AD열 주문코드 추출 ──
  const excelOrderCodes = new Set<string>();
  for (let i = 1; i < jsonData.length; i++) {
    const ad = getMergedValue(i, COL.AD_MEMO, jsonData, merges);
    if (ad === null || ad === undefined || !String(ad).trim()) continue;
    const code = String(ad).split('|')[0].trim();
    if (code) excelOrderCodes.add(code);
  }
  if (excelOrderCodes.size === 0) {
    throw new DeductParseError('엑셀 파일의 AD열에서 주문코드를 찾을 수 없습니다.');
  }
  if (excelOrderCodes.size > 1) {
    throw new DeductParseError(
      `엑셀에 주문코드가 ${excelOrderCodes.size}개 섞여 있습니다.\n한 번에 하나의 주문코드만 차감할 수 있습니다.\n\n${[...excelOrderCodes].join(', ')}`,
    );
  }
  const orderCode = [...excelOrderCodes][0];

  // ── 주문코드 형식 + user_code 일치 ──
  const m = ORDER_CODE_RE.exec(orderCode);
  if (!m) throw new DeductParseError(`주문코드 형식이 올바르지 않습니다: ${orderCode}`);
  const codeUserCode = m[1];
  const selectedUserCode = opts.selectedUserCode ?? '';
  if (selectedUserCode && codeUserCode !== selectedUserCode) {
    throw new DeductParseError(
      `유저 코드가 일치하지 않습니다.\n\n엑셀 AD열: ${codeUserCode}\n선택된 유저: ${selectedUserCode}`,
    );
  }

  // ── 합산 (G/I 는 병합 첫 행만, U 는 전 행, A 는 고유값) ──
  let delivery = 0;
  let totalI = 0;
  let qty = 0;
  const orderNos = new Set<string>();
  for (let i = 1; i < jsonData.length; i++) {
    if (isFirstRowOfMerge(i, COL.G_DELIVERY, merges)) delivery += toNum(getMergedValue(i, COL.G_DELIVERY, jsonData, merges));
    if (isFirstRowOfMerge(i, COL.I_PAID, merges)) totalI += toNum(getMergedValue(i, COL.I_PAID, jsonData, merges));
    qty += toInt(jsonData[i]?.[COL.U_QTY]);
    const no = getMergedValue(i, COL.A_ORDER_NO, jsonData, merges);
    if (no !== null && no !== undefined && String(no).trim()) orderNos.add(String(no).trim());
  }

  const delivery_fee = round2(delivery);
  const price = round2(totalI - delivery_fee);
  const service_fee = round2(price * SERVICE_FEE_RATE);
  const amount = round2(delivery_fee + price + service_fee);

  // ── 값 검증 ──
  if (delivery_fee < 0 || price < 0) {
    throw new DeductParseError(`계산값이 음수입니다. 엑셀 G열/I열을 확인해주세요.\n배송비 ${delivery_fee} / 상품가 ${price}`);
  }
  if (!(amount > 0)) throw new DeductParseError(`차감액이 0 이하입니다: ${amount}`);
  if (!(qty > 0)) throw new DeductParseError('수량(U열) 합계가 0입니다.');

  return {
    orderCode,
    orderNos1688: [...orderNos],
    delivery_fee,
    price,
    service_fee,
    amount,
    item_qty: qty,
    rowCount: jsonData.length - 1,
  };
}
