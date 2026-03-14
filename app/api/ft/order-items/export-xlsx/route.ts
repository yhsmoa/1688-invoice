import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { supabase } from '../../../../../lib/supabase';

// ============================================================
// POST /api/ft/order-items/export-xlsx
//
// ft_order_items 테이블 전체 컬럼을 XLSX 파일로 다운로드
// body: { user_id: string, status?: string }
// ============================================================

// ── 컬럼 정의 (DB 컬럼명 → 엑셀 헤더) ──────────────────────
const COLUMNS: { key: string; header: string; width: number }[] = [
  { key: 'id', header: 'ID', width: 36 },
  { key: 'created_at', header: '생성일시', width: 20 },
  { key: 'order_id', header: 'Order ID', width: 36 },
  { key: 'order_no', header: '주문번호', width: 20 },
  { key: 'item_name', header: '상품명', width: 30 },
  { key: 'option_name', header: '옵션명', width: 25 },
  { key: 'order_qty', header: '주문수량', width: 10 },
  { key: 'barcode', header: '바코드', width: 18 },
  { key: 'china_option1', header: '중국옵션1', width: 20 },
  { key: 'china_option2', header: '중국옵션2', width: 20 },
  { key: 'price_cny', header: '단가(CNY)', width: 12 },
  { key: 'price_total_cny', header: '총가(CNY)', width: 12 },
  { key: 'price_krw', header: '단가(KRW)', width: 12 },
  { key: 'price_total_krw', header: '총가(KRW)', width: 12 },
  { key: 'img_url', header: '이미지URL', width: 30 },
  { key: 'site_url', header: '사이트URL', width: 30 },
  { key: 'shipped_qty', header: '출고수량', width: 10 },
  { key: 'cancel_qty', header: '취소수량', width: 10 },
  { key: 'set_total', header: '세트수량', width: 10 },
  { key: 'set_seq', header: '세트순번', width: 10 },
  { key: 'coupang_shipment_size', header: '배송크기', width: 12 },
  { key: 'check_img', header: '검수이미지', width: 25 },
  { key: 'req_note', header: '요청사항', width: 25 },
  { key: 'note_kr', header: '비고(KR)', width: 20 },
  { key: 'note_cn', header: '비고(CN)', width: 20 },
  { key: 'kc', header: 'KC', width: 8 },
  { key: 'kc_type', header: 'KC유형', width: 12 },
  { key: 'composition', header: '혼용률', width: 20 },
  { key: 'recommanded_age', header: '권장연령', width: 12 },
  { key: 'status', header: '상태', width: 12 },
  { key: 'user_id', header: 'User ID', width: 36 },
  { key: 'item_seq', header: '아이템순번', width: 10 },
  { key: 'item_no', header: '글번호', width: 15 },
  { key: 'arrival_qty', header: '입고수량', width: 10 },
  { key: '1688_offer_id', header: '1688 Offer ID', width: 20 },
  { key: '1688_order_id', header: '1688 Order ID', width: 20 },
  { key: 'product_no', header: '상품번호', width: 15 },
];

export async function POST(request: NextRequest) {
  try {
    const { user_id } = await request.json();

    // ── 필수 파라미터 검증 ─────────────────────────────────
    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id가 필요합니다.' },
        { status: 400 }
      );
    }

    // ── DB 조회 (전체 컬럼, 해당 user_id 전체) ───────────
    const { data, error } = await supabase
      .from('ft_order_items')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];

    // ── ExcelJS 워크북 생성 ────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('ft_order_items');

    // ── 헤더 설정 ──────────────────────────────────────────
    worksheet.columns = COLUMNS.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    // ── 헤더 스타일링 (배경색 + 볼드 + 테두리) ─────────────
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF18181B' },
      };
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    // ── 데이터 행 추가 ─────────────────────────────────────
    for (const row of rows) {
      const rowData: Record<string, unknown> = {};
      for (const col of COLUMNS) {
        rowData[col.key] = (row as Record<string, unknown>)[col.key] ?? '';
      }
      worksheet.addRow(rowData);
    }

    // ── 버퍼 생성 및 응답 ──────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="ft_order_items_${today}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('ft_order_items XLSX 내보내기 오류:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'XLSX 파일 생성 중 오류가 발생했습니다.',
        details:
          (error as Record<string, unknown>)?.message ?? JSON.stringify(error),
      },
      { status: 500 }
    );
  }
}
