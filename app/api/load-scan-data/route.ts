import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SCAN_SHEET_NAME = '스캔';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

export async function GET(request: NextRequest) {
  try {
    console.log('API 호출: /api/load-scan-data');

    const { searchParams } = new URL(request.url);
    const googlesheet_id = searchParams.get('googlesheet_id');

    if (!googlesheet_id) {
      return NextResponse.json({
        error: '구글시트 ID가 필요합니다.'
      }, { status: 400 });
    }

    console.log('구글시트 ID:', googlesheet_id);

    // 서비스 계정 키가 설정되어 있는지 확인
    if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
      throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
    }

    // JWT 인증 객체 생성
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    // 인증
    await jwtClient.authorize();

    // 구글 시트 API 클라이언트 생성
    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // 1. 먼저 스캔 시트가 존재하는지 확인
    try {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: googlesheet_id,
      });

      const scanSheetExists = spreadsheet.data.sheets?.some(
        sheet => sheet.properties?.title === SCAN_SHEET_NAME
      );

      if (!scanSheetExists) {
        console.log('스캔 시트가 존재하지 않습니다.');
        return NextResponse.json({
          success: true,
          data: [],
          message: '스캔 시트가 존재하지 않습니다. 빈 데이터를 반환합니다.',
          sheetName: SCAN_SHEET_NAME
        }, { status: 200 });
      }
    } catch (error) {
      console.error('스프레드시트 정보 확인 오류:', error);
      throw new Error('스프레드시트에 접근할 수 없습니다.');
    }

    // 2. 스캔 시트에서 데이터 가져오기 (헤더 제외 2행부터)
    let scanData = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: googlesheet_id,
        range: `${SCAN_SHEET_NAME}!A2:F`,
      });

      const rows = response.data.values || [];
      console.log(`스캔 시트에서 ${rows.length}개 행 로드`);

      // 데이터 변환
      scanData = rows
        .filter(row => row[0] && row[1]) // 박스번호와 주문번호가 있는 행만
        .map((row, index) => ({
          box_number: row[0] || '',
          order_number: row[1] || '',
          scanned_qty: parseInt(row[5]) || 0, // F열(인덱스 5)에서 개수 가져오기
          row_index: index + 2 // 실제 구글시트 행 번호 (헤더 + 인덱스)
        }));

    } catch (error) {
      console.error('스캔 시트 데이터 로드 오류:', error);
      // 시트는 있지만 데이터가 없는 경우
      scanData = [];
    }

    console.log(`처리된 스캔 데이터: ${scanData.length}개`);

    const result = {
      success: true,
      data: scanData,
      message: `스캔 시트에서 ${scanData.length}개의 데이터를 불러왔습니다.`,
      sheetName: SCAN_SHEET_NAME,
      spreadsheetId: googlesheet_id
    };

    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    console.error('스캔 데이터 로드 처리 중 오류:', error);
    return NextResponse.json({
      error: '스캔 데이터 로드 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}