import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SCAN_SHEET_NAME = '작업';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

interface ScanDataItem {
  box_number: string;
  order_number: string;
  barcode: string;
  product_name: string;
  option_name: string;
  scanned_qty: number;
  available_qty: number; // 입고개수
}

interface ScanDataRequest {
  googlesheet_id: string;
  scan_data: ScanDataItem[];
}

export async function POST(request: NextRequest) {
  try {
    console.log('API 호출: /api/save-scan-data');

    // 요청 본문에서 데이터 추출
    const body: ScanDataRequest = await request.json();
    const { googlesheet_id, scan_data } = body;

    console.log('요청 데이터:', {
      googlesheet_id,
      scan_data_count: scan_data?.length
    });

    if (!googlesheet_id) {
      return NextResponse.json({
        error: '구글시트 ID가 필요합니다.'
      }, { status: 400 });
    }

    if (!scan_data || !Array.isArray(scan_data) || scan_data.length === 0) {
      return NextResponse.json({
        error: '저장할 스캔 데이터가 없습니다.'
      }, { status: 400 });
    }

    // 서비스 계정 키가 설정되어 있는지 확인
    if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
      throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
    }

    // JWT 인증 객체 생성
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // 인증
    await jwtClient.authorize();

    // 구글 시트 API 클라이언트 생성
    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // 1. 먼저 스캔 시트가 존재하는지 확인하고, 없으면 생성
    try {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: googlesheet_id,
      });

      const scanSheetExists = spreadsheet.data.sheets?.some(
        sheet => sheet.properties?.title === SCAN_SHEET_NAME
      );

      if (!scanSheetExists) {
        console.log('스캔 시트가 없어서 생성합니다.');
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: googlesheet_id,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: SCAN_SHEET_NAME,
                  },
                },
              },
            ],
          },
        });
      }

      // 헤더 행은 기존 것을 유지 (건드리지 않음)
      // 만약 시트가 새로 생성된 경우에만 헤더 추가
      if (!scanSheetExists) {
        console.log('새 시트 생성 - 헤더 행 추가 중...');
        await sheets.spreadsheets.values.update({
          spreadsheetId: googlesheet_id,
          range: `${SCAN_SHEET_NAME}!A1:G1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['박스번호', '주문번호', '바코드', '등록상품명', '옵션명', '개수', '입고개수']],
          },
        });
      }
    } catch (sheetError) {
      console.error('스캔 시트 확인/생성 오류:', sheetError);
      throw new Error('스캔 시트를 확인하거나 생성할 수 없습니다.');
    }

    // 2. 기존 데이터 모두 삭제 (헤더 제외 2행부터)
    try {
      console.log('기존 스캔 데이터 삭제 중...');

      // 먼저 전체 시트 크기 확인
      const sheetInfo = await sheets.spreadsheets.get({
        spreadsheetId: googlesheet_id,
      });

      const scanSheet = sheetInfo.data.sheets?.find(
        sheet => sheet.properties?.title === SCAN_SHEET_NAME
      );

      if (scanSheet && scanSheet.properties) {
        const maxRows = scanSheet.properties.gridProperties?.rowCount || 1000;

        // 2행부터 마지막 행까지 삭제 (헤더는 유지)
        if (maxRows > 1) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: googlesheet_id,
            range: `${SCAN_SHEET_NAME}!A2:G${maxRows}`,
          });
          console.log('기존 데이터 삭제 완료');
        }
      }
    } catch (clearError) {
      console.log('기존 데이터 삭제 중 오류 (무시하고 계속):', clearError);
    }

    // 3. 새 데이터를 2행부터 입력
    const startRow = 2; // 헤더 다음 행부터
    const endRow = startRow + scan_data.length - 1;
    const range = `${SCAN_SHEET_NAME}!A${startRow}:G${endRow}`;

    // 4. 스캔 데이터를 구글 시트 형식으로 변환
    const sheetData = scan_data.map(item => [
      item.box_number,    // A열: 박스번호
      item.order_number,  // B열: 주문번호
      item.barcode,       // C열: 바코드
      item.product_name,  // D열: 상품명
      item.option_name,   // E열: 옵션명
      item.scanned_qty,   // F열: 개수
      item.available_qty  // G열: 입고개수
    ]);

    console.log(`구글 시트에 데이터 저장: ${range}`);
    console.log('저장할 데이터:', sheetData);

    // 5. 구글 시트에 새 데이터 입력
    const updateResponse = await sheets.spreadsheets.values.update({
      spreadsheetId: googlesheet_id,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: sheetData,
      },
    });

    console.log('구글 시트 저장 완료:', updateResponse.data);

    const response = {
      success: true,
      message: `${scan_data.length}개의 스캔 데이터가 '${SCAN_SHEET_NAME}' 시트에 저장되었습니다.`,
      details: {
        spreadsheetId: googlesheet_id,
        range: range,
        dataCount: scan_data.length,
        sheetName: SCAN_SHEET_NAME
      }
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('스캔 데이터 저장 처리 중 오류:', error);
    return NextResponse.json({
      error: '스캔 데이터 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}