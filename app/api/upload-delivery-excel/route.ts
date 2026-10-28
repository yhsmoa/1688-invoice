import { NextRequest, NextResponse } from 'next/server';
import { DeliveryExcelError, parseDeliveryExcel, type ParsedDeliveryFile } from '../../../lib/deliveryInfoExcel';
import { replaceDeliveryInfoByAccount } from '../../../lib/deliveryInfoUpload';

// ============================================================
// POST /api/upload-delivery-excel — [1688 XLSX]
//   1688 주문 엑셀 → 1688_invoice_deliveryInfo_check (주문번호 ↔ 송장번호 · 주문정보)
//
//   1688 주문은 두 계정에서 진행하고 엑셀은 계정마다 따로 받는다.
//   올린 파일의 계정(C열 买家会员名) 행만 교체한다 — 다른 계정 데이터는 그대로.
//
//   요청: multipart/form-data, file × 1 이상 (계정별 엑셀 여러 개를 한 번에 올려도 됨)
//   처리:
//     1) 파일마다 파싱·검증 (헤더 · 계정 — lib/deliveryInfoExcel.ts)
//     2) 같은 계정 파일이 둘이면 거부
//     3) 모든 계정을 한 번에 교체 (DB 함수 — 한 트랜잭션, 실패하면 아무것도 바뀌지 않음)
//   검증에 걸리면 아무것도 지우지 않는다.
//
//   응답: { success, count, savedCount, errorCount: 0, accounts: [{ account, file, orders, inserted, deleted }] }
//   호출: 상품입고 V1(app/import-product) · V2/V3 · 주문상태 V2 (hooks/useImportUploads)
// ============================================================

export const dynamic = 'force-dynamic';

const MAX_FILES = 5;

const fail = (error: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ success: false, error, ...extra }, { status });

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) return fail('파일이 업로드되지 않았습니다.', 400);
    if (files.length > MAX_FILES) return fail(`한 번에 최대 ${MAX_FILES}개 파일까지 올릴 수 있습니다.`, 400);
    const notExcel = files.find((f) => !/\.(xlsx|xls)$/i.test(f.name));
    if (notExcel) return fail(`엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다: ${notExcel.name}`, 400);

    // ── 1) 파일마다 파싱·검증 ──
    const parsed: Array<ParsedDeliveryFile & { file: string }> = [];
    for (const f of files) {
      try {
        const p = parseDeliveryExcel(Buffer.from(await f.arrayBuffer()));
        parsed.push({ ...p, file: f.name });
      } catch (e) {
        if (e instanceof DeliveryExcelError) return fail(`${f.name}: ${e.message} 기존 데이터는 그대로입니다.`, 400);
        throw e;
      }
    }

    // ── 2) 같은 계정 파일이 둘이면 거부 ──
    const seen = new Map<string, string>();
    for (const p of parsed) {
      const prev = seen.get(p.account);
      if (prev) return fail(`같은 계정(${p.account}) 파일이 두 개입니다: ${prev}, ${p.file}. 계정마다 파일 하나만 올려 주세요.`, 400);
      seen.set(p.account, p.file);
    }

    // ── 3) 계정별 교체 (한 트랜잭션) ──
    const rows = parsed.flatMap((p) => p.rows);
    let result;
    try {
      result = await replaceDeliveryInfoByAccount(parsed.map((p) => p.account), rows);
    } catch (e) {
      console.error('배송정보 계정별 교체 오류:', e);
      return fail(`저장 중 오류가 발생했습니다. 기존 데이터는 그대로입니다. (${e instanceof Error ? e.message : 'unknown'})`, 500);
    }

    const byAccount = new Map(result.accounts.map((a) => [a.account, a]));
    return NextResponse.json({
      success: true,
      count: rows.length,
      savedCount: result.inserted,
      errorCount: 0,
      accounts: parsed.map((p) => ({
        account: p.account,
        file: p.file,
        orders: p.orderCount,
        inserted: byAccount.get(p.account)?.inserted ?? 0,
        deleted: byAccount.get(p.account)?.deleted ?? 0,
      })),
    });
  } catch (error) {
    console.error('배송정보 엑셀 업로드 오류:', error);
    return fail('엑셀 파일 처리 중 오류가 발생했습니다. 기존 데이터는 그대로입니다.', 500, {
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
