import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { fail, serverError, fetchIn } from '../../storageShared';

export const dynamic = 'force-dynamic';

// ============================================================
// POST /api/ft/storage/wow/courier — [택배엑셀] (와우출고 [서류준비] 탭)
//   body { box_ids: string[] } → 택배 접수 엑셀 (.xlsx). 박스 하나 = 한 행, 받은 순서(화면 순서)대로
//
//   받는사람 = 쿠팡 물류센터 · 전화번호1 · 주소 = 그 센터의 연락처 · 주소 · 수량(A타입) = 1
//   상품명1 = "[크기] 센터 - 발주번호 - N번 (총 M박스) - 수량개"
//     로켓 CJ 엑셀의 발주번호 열과 같은 형식 (immongRK_scan cjRef.js formatCjRef — 바꾸면 같이 바꾼다)
//     수량 = 그 박스에 담은 수량 (담기 전이면 요청 수량)
//   센터 연락처 · 주소 · 총 박스 수는 로켓이 박스에 채워 둔다 (supabase/storage/009_wow_courier.sql)
//     — 아직 받지 못한 박스가 하나라도 있으면 빈 칸으로 내보내지 않고 409 로 알린다
// ============================================================

const MAX_BOXES = 500;

interface BoxRow {
  id: string;
  order_number: string;
  box_no: number;
  center: string | null;
  box_size: string | null;
  order_box_total: number | null;
  center_phone: string | null;
  center_address: string | null;
}

interface ItemRow {
  wow_box_id: string;
  qty: number;
  picked_qty: number | null;
  picked_at: string | null;
}

/** 엑셀 열 — [머리글, 너비, 박스 → 값] */
type CourierRow = { box: BoxRow; qty: number };
const COLUMNS: readonly [string, number, (r: CourierRow) => string | number][] = [
  ['받는사람', 14, ({ box }) => box.center ?? ''],
  ['전화번호1', 16, ({ box }) => formatPhone(box.center_phone ?? '')],
  ['우편번호', 10, () => ''],
  ['주소', 52, ({ box }) => box.center_address ?? ''],
  ['수량(A타입)', 12, () => 1],
  ['상품명1', 47, ({ box, qty }) =>
    `[${box.box_size ?? ''}] ${box.center ?? ''} - ${box.order_number} - ${box.box_no}번 (총 ${box.order_box_total}박스) - ${qty}개`],
];

/** 전화번호에 하이픈 — 02-xxxx-xxxx · 0xx-xxx(x)-xxxx. 그 밖의 형식(대표번호 등)은 받은 그대로 */
function formatPhone(raw: string): string {
  const m = /^(02|0\d{2})(\d{3,4})(\d{4})$/.exec(raw.replace(/\D/g, ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

const THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;

export async function POST(request: NextRequest) {
  try {
    const { box_ids } = await request.json();
    const ids = Array.isArray(box_ids) ? box_ids.filter((v): v is string => typeof v === 'string' && !!v) : [];
    if (ids.length === 0) return fail('박스를 선택해 주세요.');
    if (ids.length > MAX_BOXES) return fail(`한 번에 ${MAX_BOXES}박스까지 받을 수 있습니다.`);

    const [boxes, items] = await Promise.all([
      fetchIn<BoxRow>('ft_wow_boxes',
        'id, order_number, box_no, center, box_size, order_box_total, center_phone, center_address', 'id', ids),
      fetchIn<ItemRow>('ft_wow_items', 'wow_box_id, qty, picked_qty, picked_at', 'wow_box_id', ids),
    ]);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const qtyOf = new Map<string, number>();
    for (const i of items) {
      qtyOf.set(i.wow_box_id, (qtyOf.get(i.wow_box_id) ?? 0) + (i.picked_at ? i.picked_qty ?? 0 : i.qty));
    }

    // ── 받은 순서대로 (없어진 박스는 건너뛴다) ──
    const rows: CourierRow[] = [];
    for (const id of new Set(ids)) {
      const box = byId.get(id);
      if (box) rows.push({ box, qty: qtyOf.get(id) ?? 0 });
    }
    if (rows.length === 0) return fail('와우출고 박스를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.', 404);

    const missing = rows.filter(({ box }) => !box.center || !box.center_address || !box.order_box_total)
      .map(({ box }) => `${box.order_number}-${box.box_no}`);
    if (missing.length > 0) {
      return fail(`받는 곳(센터 주소 · 총 박스 수) 정보가 아직 없는 박스가 있습니다: ${missing.join(', ')}. 로켓에서 정보를 다시 보내야 합니다.`, 409);
    }

    // ── 엑셀: 머리글(가운데) + 박스 행(테두리 · 왼쪽 · 텍스트) ──
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.columns = COLUMNS.map(([, width]) => ({ width }));
    sheet.addRow(COLUMNS.map(([header]) => header)).eachCell((cell) => {
      cell.alignment = { horizontal: 'center' };
    });
    for (const row of rows) {
      sheet.addRow(COLUMNS.map(([, , valueOf]) => valueOf(row))).eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: '맑은 고딕', size: 11 };
        cell.alignment = { horizontal: 'left' };
        cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
        if (typeof cell.value === 'string') cell.numFmt = '@';
      });
    }

    return new NextResponse(Buffer.from(await workbook.xlsx.writeBuffer()), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="wow-courier.xlsx"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return serverError('와우출고 택배엑셀', error);
  }
}
