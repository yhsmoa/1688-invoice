import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 구글 시트 ID
const SPREADSHEET_ID = '1yxaocZlgSEUJIurxQHjPNIp6D67frOv9INMeV-XIwP0';
const SHEET_NAME = '주문';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? 
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

interface SheetRow {
  orderNumber: string;
  date: string;
  productName: string;
  optionName: string;
  barcode: string;
  chinaOption1: string;
  chinaOption2: string;
  price: number;
  totalPrice: number;
  imgUrl: string;
  siteUrl: string;
  orderedQty: number;
  importQty: number | null;
  cancelQty: number | null;
  exportQty: number | null;
  offerId: string | null;
  orderQty: number;
}

export async function GET(request: NextRequest) {
  try {
    console.log('구글 시트 API 호출 시작');
    
    // URL 파라미터에서 googlesheet_id 가져오기
    const searchParams = request.nextUrl.searchParams;
    const googleSheetId = searchParams.get('googlesheet_id') || SPREADSHEET_ID;
    
    console.log('구글 시트 ID:', googleSheetId);
    console.log('시트명:', SHEET_NAME);
    
    // 구글 시트 API 호출
    console.log('구글 시트 API 호출 시작...');
    
    try {
      // 서비스 계정을 사용하여 JWT 클라이언트 생성
      const jwtClient = new JWT({
        email: SERVICE_ACCOUNT_EMAIL,
        key: PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
      
      // 인증
      await jwtClient.authorize();
      
      // 구글 시트 API 클라이언트 생성
      const sheets = google.sheets({ version: 'v4', auth: jwtClient });
      
      // 구글 시트에서 데이터 가져오기
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: googleSheetId,
        range: SHEET_NAME,
      });
      
      console.log('구글 시트 API 응답 상태:', response.status);
      
      if (!response.data || !response.data.values) {
        console.error('구글 시트에 데이터가 없습니다.');
        return NextResponse.json({ 
          error: '구글 시트에 데이터가 없습니다.' 
        }, { status: 400 });
      }

      const data = response.data;
      console.log('구글 시트 데이터 수신 완료, 행 수:', data.values?.length || 0);
      
      if (!data.values || data.values.length === 0) {
        return NextResponse.json({ 
          error: '구글 시트에 데이터가 없습니다.' 
        }, { status: 400 });
      }
      
      const rows = data.values;
      
      // 헤더 제외 (첫 2행은 헤더)
      const dataRows = rows.slice(2);
      
      if (dataRows.length === 0) {
        return NextResponse.json({ 
          message: '구글 시트에 데이터가 없습니다.' 
        }, { status: 200 });
      }
      
      // 데이터 변환
      console.log('데이터 변환 시작, 행 수:', dataRows.length);
      const processedData = dataRows.map((row: any[], index: number) => {
        try {
          // site_url에서 offer_id 추출
          let offerId = null;
          const siteUrl = row[18] || ''; // S열 (19번째 열, 0-indexed)
          
          if (siteUrl && typeof siteUrl === 'string') {
            const match = siteUrl.match(/offer\/(\d+)\.html/);
            if (match && match[1]) {
              offerId = match[1];
            }
          }

          // 날짜는 원본 형식 그대로 저장 (text 타입으로 변경됨)
          const dateStr = row[7] ? row[7].toString() : null;
          console.log(`행 ${index + 3} 날짜 값:`, dateStr);

          // 구글 시트 행 번호 (헤더 2줄 + 1부터 시작하는 인덱스)
          const rowNumber = (index + 3).toString();

          return {
            row_id: rowNumber, // UUID 대신 구글 시트 행 번호 사용
            order_number: row[6] || '', // G열
            date: dateStr, // 원본 형식 그대로 저장 (text 타입)
            product_name: row[8] || null, // I열
            option_name: row[9] || null, // J열
            barcode: row[10] || null, // K열
            china_option1: row[13] || null, // N열
            china_option2: row[14] || null, // O열
            price: parseFloat(row[15]) || null, // P열
            total_price: parseFloat(row[16]) || null, // Q열
            img_url: row[17] || null, // R열
            site_url: row[18] || null, // S열
            ordered_qty: parseInt(row[19]) || null, // T열
            import_qty: parseInt(row[20]) || null, // U열
            cancel_qty: parseInt(row[21]) || null, // V열
            export_qty: parseInt(row[22]) || null, // W열
            '1688_order_number': null, // 비워둠
            offer_id: offerId, // 추출한 offer_id
            order_qty: parseInt(row[12]) || null, // M열
          };
        } catch (error) {
          console.error(`행 ${index + 3} 처리 중 오류:`, error, '행 데이터:', row);
          return {
            row_id: (index + 3).toString(), // 구글 시트 행 번호
            order_number: row[6] || `오류_행_${index + 3}`,
            date: null,
            product_name: '데이터 처리 중 오류 발생',
            option_name: null,
            barcode: null,
            china_option1: null,
            china_option2: null,
            price: null,
            total_price: null,
            img_url: null,
            site_url: null,
            ordered_qty: null,
            import_qty: null,
            cancel_qty: null,
            export_qty: null,
            '1688_order_number': null,
            offer_id: null,
            order_qty: null,
          };
        }
      });
      console.log('데이터 변환 완료, 처리된 행 수:', processedData.length);
      
      // 빈 order_number 필터링
      const filteredData = processedData.filter((item: any) => item.order_number && item.order_number.trim() !== '');
      console.log('유효한 order_number를 가진 행 수:', filteredData.length);
      
      if (filteredData.length === 0) {
        return NextResponse.json({ 
          error: '유효한 order_number를 가진 데이터가 없습니다.', 
          details: '모든 행의 order_number가 비어 있습니다.' 
        }, { status: 400 });
      }
      
      // 기존 데이터 삭제 후 새 데이터 삽입
      console.log('기존 데이터 삭제 시작');
      const { error: deleteError } = await supabase
        .from('invoice_import_googlesheet')
        .delete()
        .neq('order_number', ''); // 모든 데이터 삭제
        
      if (deleteError) {
        console.error('기존 데이터 삭제 오류:', deleteError);
        // 삭제 실패해도 계속 진행
      } else {
        console.log('기존 데이터 삭제 완료');
      }
      
      // 새 데이터 삽입
      console.log('새 데이터 삽입 시작');
      
      // 테이블의 고유 제약 조건 확인
      const { data: tableInfo, error: tableError } = await supabase
        .from('invoice_import_googlesheet')
        .select('*')
        .limit(1);
        
      if (tableError) {
        console.error('테이블 정보 확인 오류:', tableError);
      }
      
      // 청크로 나누어 데이터 삽입 (한 번에 100개씩)
      const chunkSize = 100;
      let insertedCount = 0;
      let errors = [];
      
      for (let i = 0; i < filteredData.length; i += chunkSize) {
        const chunk = filteredData.slice(i, i + chunkSize);
        console.log(`청크 삽입: ${i / chunkSize + 1}/${Math.ceil(filteredData.length / chunkSize)} (${chunk.length}개 항목)`);
        
        const { data: insertedChunk, error: chunkError } = await supabase
          .from('invoice_import_googlesheet')
          .insert(chunk);
          
        if (chunkError) {
          console.error(`청크 ${i / chunkSize + 1} 삽입 오류:`, chunkError);
          errors.push({
            chunk: i / chunkSize + 1,
            message: chunkError.message,
            code: chunkError.code
          });
        } else {
          insertedCount += chunk.length;
        }
      }
      
      if (errors.length > 0) {
        console.error('일부 데이터 삽입 중 오류 발생:', errors);
        return NextResponse.json({ 
          error: '일부 데이터 저장 중 오류가 발생했습니다.', 
          details: `${insertedCount}/${filteredData.length}개 항목이 저장되었습니다.`,
          errors: errors
        }, { status: 500 });
      }
      
      // 구글 시트 업데이트는 제거 (무한루프 방지)
      console.log('Supabase 데이터 저장 완료');

      return NextResponse.json({ 
        success: true, 
        message: `${insertedCount}개의 데이터가 성공적으로 저장되었습니다.`,
        count: insertedCount
      });
    } catch (apiError) {
      console.error('구글 시트 API 호출 또는 데이터 처리 중 오류:', apiError);
      return NextResponse.json({ 
        error: '구글 시트 API 호출 또는 데이터 처리 중 오류가 발생했습니다.',
        details: apiError instanceof Error ? apiError.message : '알 수 없는 오류'
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('구글 시트 데이터 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '구글 시트 데이터 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 