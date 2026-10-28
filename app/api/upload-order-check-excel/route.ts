import { NextRequest, NextResponse } from 'next/server';
import { DeliveryExcelError, parseOrderCheckExcel } from '../../../lib/deliveryInfoExcel';
import { replaceDeliveryInfoByAccount } from '../../../lib/deliveryInfoUpload';

// ============================================================
// POST /api/upload-order-check-excel — 주문 검사 (/order-check)
//   1688 주문 엑셀 → 1688_invoice_deliveryInfo_check (주문 단위 · 결제시각 포함)
//
//   [1688 XLSX] 와 같은 표를 쓰므로 같은 규칙: 올린 파일의 계정(C열 买家会员名) 행만 교체한다.
//   (예전에는 표 전체를 지워, 주문 검사 업로드가 다른 계정 데이터까지 지웠다)
//
//   요청: multipart/form-data, file × 1
//   파싱·검증: lib/deliveryInfoExcel.ts parseOrderCheckExcel — 걸리면 아무것도 지우지 않는다
//   저장: DB 함수 한 번 = 한 트랜잭션 (실패하면 아무것도 바뀌지 않음)
//   응답: { success, message, count, savedCount, errorCount: 0, account }
// ============================================================

export const dynamic = 'force-dynamic';

const fail = (error: string, status: number, extra?: Record<string, unknown>) =>
  NextResponse.json({ success: false, error, ...extra }, { status });

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return fail('파일이 업로드되지 않았습니다.', 400);
    if (!/\.(xlsx|xls)$/i.test(file.name)) return fail('엑셀 파일(.xlsx 또는 .xls)만 업로드 가능합니다.', 400);

    // ── 파싱·검증 ──
    let parsed;
    try {
      parsed = parseOrderCheckExcel(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof DeliveryExcelError) return fail(`${e.message} 기존 데이터는 그대로입니다.`, 400);
      throw e;
    }

    // ── 계정별 교체 (한 트랜잭션) ──
    let result;
    try {
      result = await replaceDeliveryInfoByAccount([parsed.account], parsed.rows);
    } catch (e) {
      console.error('주문 검사 계정별 교체 오류:', e);
      return fail(`저장 중 오류가 발생했습니다. 기존 데이터는 그대로입니다. (${e instanceof Error ? e.message : 'unknown'})`, 500);
    }

    return NextResponse.json({
      success: true,
      message: `주문 검사 엑셀 업로드 완료 — 계정 ${parsed.account} ${result.inserted}건 저장 (이 계정의 이전 ${result.deleted}건 교체)`,
      count: parsed.rows.length,
      savedCount: result.inserted,
      errorCount: 0,
      account: parsed.account,
    });
  } catch (error) {
    console.error('주문 검사 엑셀 업로드 오류:', error);
    return fail('엑셀 파일 처리 중 오류가 발생했습니다. 기존 데이터는 그대로입니다.', 500, {
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
