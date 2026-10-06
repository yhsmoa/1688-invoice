import { NextRequest, NextResponse } from 'next/server';
import { guardDbRoute } from '../../../../lib/dbAccess';
import { readStampImage } from '../../../../lib/tradeInvoiceServer';

export const dynamic = 'force-dynamic';

// ============================================================
// GET /api/trade-invoice/stamp
//   인보이스 도장 이미지 (assets/trade-invoice/stamp.png)
//   회사 인감이므로 public/ 에 두지 않고 DB 관리 접근 코드로 보호한다.
//   미리보기·JPG·PDF 가 쓰고, EXCEL2 는 서버에서 직접 읽는다.
// ============================================================
export async function GET(request: NextRequest) {
  const denied = await guardDbRoute(request);
  if (denied) return denied;
  try {
    const png = await readStampImage();
    return new NextResponse(png, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (error) {
    console.error('인보이스 도장 이미지 읽기 오류:', error);
    return NextResponse.json({ success: false, error: '도장 이미지를 읽을 수 없습니다.' }, { status: 500 });
  }
}
