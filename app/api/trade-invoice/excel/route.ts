import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { invoiceFileBase, isValidInvoiceAmount, isValidInvoiceDate, type InvoiceInput } from '../../../../lib/tradeInvoice';
import { buildInvoiceV2, buildTemplateInvoice } from '../../../../lib/tradeInvoiceServer';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/trade-invoice/excel?variant=template|v2&amount=30000&date=YYYY-MM-DD
//   PROFORMA INVOICE 엑셀 다운로드 (DB 관리 접근 코드 필요)
//     template — 원본 템플릿에 값만 치환 ([excel] 버튼)
//     v2       — 개정 레이아웃으로 새로 생성 ([EXCEL2] 버튼)
//   날짜는 클라이언트 로컬 날짜를 받는다 (서버는 UTC 라 자정 근처에 어긋남)
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get('variant') ?? 'template';
  const amount = Number(searchParams.get('amount'));
  const date = searchParams.get('date') ?? '';

  if (variant !== 'template' && variant !== 'v2') {
    return NextResponse.json({ success: false, error: 'variant 는 template 또는 v2 여야 합니다.' }, { status: 400 });
  }
  if (!isValidInvoiceAmount(amount)) {
    return NextResponse.json({ success: false, error: '금액은 1 이상의 정수여야 합니다.' }, { status: 400 });
  }
  if (!isValidInvoiceDate(date)) {
    return NextResponse.json({ success: false, error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' }, { status: 400 });
  }

  const input: InvoiceInput = { amount, date };
  try {
    const buffer = variant === 'v2' ? await buildInvoiceV2(input) : await buildTemplateInvoice(input);
    const filename = encodeURIComponent(`${invoiceFileBase(date)}${variant === 'v2' ? '_v2' : ''}.xlsx`);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('인보이스 엑셀 생성 오류:', error);
    return NextResponse.json({ success: false, error: '엑셀 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
