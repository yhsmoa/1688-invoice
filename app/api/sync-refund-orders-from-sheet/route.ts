import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { supabase } from '../../../lib/supabase';

// 취소내역 시트명
const SHEET_NAME = '취소내역';

// 서비스 계정 키 정보
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : '';

interface SheetRow {
  order_number: string;
  product_name: string | null;
  option_name_cn: string | null;
  img_url: string | null;
  site_url: string | null;
  qty: number | null;
  refund_description: string | null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { googlesheet_id, user_id, master_account } = body;

    // 필수 파라미터 검증
    if (!googlesheet_id) {
      return NextResponse.json({
        success: false,
        error: 'googlesheet_id가 필요합니다.',
      }, { status: 400 });
    }

    if (!user_id) {
      return NextResponse.json({
        success: false,
        error: 'user_id가 필요합니다.',
      }, { status: 400 });
    }

    console.log('=== 취소내역 동기화 시작 ===');
    console.log('googlesheet_id:', googlesheet_id);
    console.log('user_id:', user_id);
    console.log('master_account:', master_account);

    // 1. 구글 시트에서 '취소내역' 데이터 가져오기
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    await jwtClient.authorize();

    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // A:R 범위로 데이터 가져오기
    const range = `${SHEET_NAME}!A:R`;

    console.log('구글 시트 데이터 요청 중...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: googlesheet_id,
      range: range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });

    if (!response.data.values || response.data.values.length === 0) {
      return NextResponse.json({
        success: true,
        message: '취소내역 시트에 데이터가 없습니다.',
        added: 0,
        skipped: 0,
        loadTime: Date.now() - startTime,
      });
    }

    const rows = response.data.values;
    console.log('구글 시트 데이터 행 수:', rows.length);

    // 헤더 제외 (첫 1행)
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) {
      return NextResponse.json({
        success: true,
        message: '취소내역 시트에 데이터가 없습니다.',
        added: 0,
        skipped: 0,
        loadTime: Date.now() - startTime,
      });
    }

    // 2. 구글 시트 데이터 파싱
    const sheetData: SheetRow[] = dataRows
      .filter((row: any[]) => {
        // B열(order_number)이 있고, O열(취소수량)이 0보다 큰 행만
        const hasOrderNumber = row[1] && row[1].toString().trim() !== '';
        const qty = row[14] ? parseInt(row[14]) : 0;
        return hasOrderNumber && qty > 0;
      })
      .map((row: any[]) => {
        // C열 + D열 합치기 (product_name)
        const productName = [row[2], row[3]]
          .filter(Boolean)
          .map(v => v.toString().trim())
          .join(', ');

        // G열 + H열 합치기 (option_name_cn)
        const optionNameCn = [row[6], row[7]]
          .filter(Boolean)
          .map(v => v.toString().trim())
          .join(', ');

        return {
          order_number: row[1]?.toString().trim() || '',
          product_name: productName || null,
          option_name_cn: optionNameCn || null,
          img_url: row[10]?.toString().trim() || null, // K열
          site_url: row[11]?.toString().trim() || null, // L열
          qty: row[14] ? parseInt(row[14]) : null, // O열
          refund_description: row[17]?.toString().trim() || null, // R열
        };
      });

    console.log('파싱된 시트 데이터 수:', sheetData.length);

    if (sheetData.length === 0) {
      return NextResponse.json({
        success: true,
        message: '유효한 취소내역 데이터가 없습니다.',
        added: 0,
        skipped: 0,
        loadTime: Date.now() - startTime,
      });
    }

    // 3. 기존 order_number 목록 조회 (해당 user_id의 데이터만, 페이지네이션으로 전체 조회)
    let existingOrderNumbers = new Set<string>();
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: existingOrders, error: selectError } = await supabase
        .from('invoiceManager_refundOrder')
        .select('order_number')
        .eq('user_id', user_id)
        .range(from, from + pageSize - 1);

      if (selectError) {
        console.error('기존 데이터 조회 오류:', selectError);
        return NextResponse.json({
          success: false,
          error: '기존 데이터 조회 중 오류가 발생했습니다.',
          details: selectError.message,
        }, { status: 500 });
      }

      if (existingOrders && existingOrders.length > 0) {
        existingOrders.forEach(o => {
          if (o.order_number) existingOrderNumbers.add(o.order_number);
        });
        from += pageSize;
        hasMore = existingOrders.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    console.log('기존 order_number 수:', existingOrderNumbers.size);

    // 4. 새로운 데이터만 필터링
    const newData = sheetData.filter(
      item => !existingOrderNumbers.has(item.order_number)
    );

    console.log('새로 추가할 데이터 수:', newData.length);
    console.log('스킵된 데이터 수:', sheetData.length - newData.length);

    if (newData.length === 0) {
      return NextResponse.json({
        success: true,
        message: '추가할 새로운 데이터가 없습니다. 모든 데이터가 이미 존재합니다.',
        added: 0,
        skipped: sheetData.length,
        loadTime: Date.now() - startTime,
      });
    }

    // 5. Supabase에 새 데이터 삽입
    const insertData = newData.map(item => ({
      user_id: user_id,
      order_number: item.order_number,
      product_name: item.product_name,
      option_name_cn: item.option_name_cn,
      img_url: item.img_url,
      site_url: item.site_url,
      qty: item.qty,
      refund_description: item.refund_description,
      refund_type: '청도접수',
      refund_status: '접수',
      master_account: master_account || null,
    }));

    // 배치로 나누어서 삽입 (100개씩)
    const batchSize = 100;
    let insertedCount = 0;
    let insertErrors: string[] = [];

    for (let i = 0; i < insertData.length; i += batchSize) {
      const batch = insertData.slice(i, i + batchSize);

      const { data: insertedData, error: insertError } = await supabase
        .from('invoiceManager_refundOrder')
        .insert(batch)
        .select();

      if (insertError) {
        console.error(`배치 ${Math.floor(i / batchSize) + 1} 삽입 오류:`, insertError);
        insertErrors.push(insertError.message);
      } else {
        insertedCount += insertedData?.length || 0;
      }
    }

    const loadTime = Date.now() - startTime;

    console.log('=== 취소내역 동기화 완료 ===');
    console.log('추가된 데이터:', insertedCount);
    console.log('스킵된 데이터:', sheetData.length - newData.length);
    console.log('처리 시간:', loadTime, 'ms');

    if (insertErrors.length > 0) {
      return NextResponse.json({
        success: true,
        message: `일부 데이터가 추가되었습니다. (오류 ${insertErrors.length}건)`,
        added: insertedCount,
        skipped: sheetData.length - newData.length,
        errors: insertErrors,
        loadTime,
      });
    }

    return NextResponse.json({
      success: true,
      message: `${insertedCount}개의 새로운 환불 주문이 추가되었습니다.`,
      added: insertedCount,
      skipped: sheetData.length - newData.length,
      loadTime,
    });

  } catch (error) {
    console.error('취소내역 동기화 오류:', error);
    return NextResponse.json({
      success: false,
      error: '취소내역 동기화 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류',
    }, { status: 500 });
  }
}
