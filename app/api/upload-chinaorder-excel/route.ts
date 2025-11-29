import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: '파일이 없습니다.' },
        { status: 400 }
      );
    }

    // 파일을 ArrayBuffer로 읽기
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // XLSX로 파싱
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // 시트를 JSON으로 변환 (header: 1 옵션으로 배열로 가져오기)
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (rawData.length <= 1) {
      return NextResponse.json(
        { success: false, error: '데이터가 없습니다.' },
        { status: 400 }
      );
    }

    // 헤더 제거하고 데이터만 추출 (첫 번째 행은 헤더)
    const dataRows = rawData.slice(1);

    const records = [];

    for (const row of dataRows) {
      // 빈 행 건너뛰기
      if (!row || row.length === 0 || !row[1]) {
        continue;
      }

      const dateCol = row[0] || ''; // A열
      const orderNumber = row[1] || ''; // B열
      const productName = row[2] || null; // C열
      const optionName = row[3] || null; // D열
      const qty = row[4] ? parseInt(row[4]) : null; // E열
      const barcode = row[5] || null; // F열
      const chinaOption1 = row[6] || null; // G열
      const chinaOption2 = row[7] || null; // H열
      const chinaPrice = row[8] ? parseFloat(row[8]) : null; // I열
      const chinaTotalPrice = row[9] ? parseFloat(row[9]) : null; // J열
      const imgUrl = row[10] || null; // K열
      const siteUrl = row[11] || null; // L열
      const statusProgress = row[12] ? parseInt(row[12]) : null; // M열
      const statusReceiving = row[13] ? parseInt(row[13]) : null; // N열
      const statusCancel = row[14] ? parseInt(row[14]) : null; // O열
      const statusExport = row[15] ? parseInt(row[15]) : null; // P열
      const noteKr = row[16] || null; // Q열
      const noteCn = row[17] || null; // R열
      const orderCode = row[18] || null; // S열
      const shipmentCode = row[19] || null; // T열
      const optionId = row[20] || null; // U열
      const shipmentInfo = row[21] || null; // V열
      const colW = row[22] || null; // W열
      const colX = row[23] || null; // X열
      const colY = row[24] || null; // Y열
      const colZ = row[25] || null; // Z열

      // ID 생성: S열 & "-" & B열
      const id = `${orderCode || ''}-${orderNumber || ''}`;

      if (!id || id === '-') {
        continue; // ID가 없으면 건너뛰기
      }

      records.push({
        date: dateCol,
        id: id,
        order_number: orderNumber,
        product_name: productName,
        option_name: optionName,
        qty: qty,
        barcode: barcode,
        china_option1: chinaOption1,
        china_option2: chinaOption2,
        china_price: chinaPrice,
        china_total_price: chinaTotalPrice,
        img_url: imgUrl,
        site_url: siteUrl,
        status_progress: statusProgress,
        status_receving: statusReceiving,
        status_cancel: statusCancel,
        status_export: statusExport,
        note_kr: noteKr,
        note_cn: noteCn,
        order_code: orderCode,
        shipment_code: shipmentCode,
        option_id: optionId,
        shipment_info: shipmentInfo,
        col_w: colW,
        col_x: colX,
        col_y: colY,
        col_z: colZ,
        user_id: null,
        user_code: null,
        status: '신규'
      });
    }

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, error: '유효한 데이터가 없습니다.' },
        { status: 400 }
      );
    }

    console.log(`총 ${records.length}개의 레코드를 업로드합니다.`);

    // Supabase에 upsert (id가 primary key이므로 중복 시 업데이트)
    const { data, error } = await supabase
      .from('chinaorder_original')
      .upsert(records, { onConflict: 'id' });

    if (error) {
      console.error('Supabase upsert 오류:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(`${records.length}개의 레코드가 성공적으로 저장되었습니다.`);

    return NextResponse.json({
      success: true,
      count: records.length,
      message: `${records.length}개의 데이터가 저장되었습니다.`
    });

  } catch (error) {
    console.error('엑셀 업로드 오류:', error);
    return NextResponse.json(
      { success: false, error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
