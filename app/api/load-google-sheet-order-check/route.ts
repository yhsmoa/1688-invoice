import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('주문 검사 구글 시트 API 호출 시작');

    // Request body에서 googlesheet_id와 coupang_name 가져오기
    const body = await request.json();
    const { googlesheet_id, coupang_name } = body;

    if (!googlesheet_id) {
      return NextResponse.json({
        error: '구글 시트 ID가 제공되지 않았습니다.'
      }, { status: 400 });
    }

    console.log('구글 시트 ID:', googlesheet_id);
    console.log('쿠팡 사용자:', coupang_name);
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
        spreadsheetId: googlesheet_id,
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
          success: true,
          message: '구글 시트에 데이터가 없습니다.',
          data: []
        }, { status: 200 });
      }

      // 데이터 변환 - 상품 입고 페이지와 동일한 매핑
      console.log('데이터 변환 시작, 행 수:', dataRows.length);
      const processedData = dataRows.map((row: any[], index: number) => {
        try {
          // 빈 행 체크 - B열(order_number)이 없고 A열도 없으면 스킵
          if ((!row[1] || row[1].toString().trim() === '') && (!row[0] || row[0].toString().trim() === '')) {
            return null;
          }

          // 구글 시트 행 번호 (헤더 1줄 + 1부터 시작하는 인덱스)
          const rowNumber = (index + 2).toString();

          // 첫 번째 행 디버깅
          if (index === 0) {
            console.log('첫 번째 행 디버깅:');
            console.log('Row 길이:', row.length);
            console.log('A열(0):', row[0]);
            console.log('B열(1):', row[1]);
            console.log('C열(2):', row[2]);
            console.log('D열(3):', row[3]);
            console.log('E열(4):', row[4]);
            console.log('F열(5):', row[5]);
            console.log('G열(6):', row[6]);
            console.log('H열(7):', row[7]);
            console.log('I열(8):', row[8]);
            console.log('J열(9):', row[9]);
            console.log('K열(10):', row[10]);
            console.log('L열(11):', row[11]);
          }

          return {
            id: `${row[1] || 'unknown'}-${rowNumber}`,
            row_number: rowNumber,
            image_url: row[10] || null, // K열 - 이미지
            site_url: row[11] || null, // L열 - 사이트 URL
            order_number_prefix: row[0] || '', // A열 - 글번호 앞부분
            order_number: row[1] || '', // B열 - 글번호 뒷부분
            product_name: row[2] || null, // C열 - 상품명 첫 줄
            product_name_sub: row[3] || null, // D열 - 상품명 둘째 줄
            barcode: row[5] || null, // F열 - 바코드
            china_option1: row[6] || null, // G열 - 주문옵션 첫 줄
            china_option2: row[7] || null, // H열 - 주문옵션 둘째 줄
            order_qty: row[4] ? parseInt(row[4]) : 0, // E열 - 개수
            cost: row[8] || null, // I열 - 비용 첫 줄
            cost_sub: row[9] || null, // J열 - 비용 둘째 줄
            progress_status: row[12] ? parseInt(row[12]) : null, // M열 - 진행
            import_qty: row[13] ? parseInt(row[13]) : null, // N열 - 입고
            cancel_qty: row[14] ? parseInt(row[14]) : null, // O열 - 취소
            export_qty: row[15] ? parseInt(row[15]) : null, // P열 - 출고
            note: row[17] || null, // R열 - 비고
            option_id: row[20] || null, // U열 - 옵션 ID
            product_size: row[21] || null, // V열 - 상품 입고 사이즈
            delivery_status: null, // 배송 상태 (deliveryInfo에서 매핑)
          };
        } catch (error) {
          console.error(`행 ${index + 2} 처리 중 오류:`, error, '행 데이터:', row);
          return null;
        }
      }).filter(item => item !== null);

      console.log('데이터 변환 완료, 처리된 행 수:', processedData.length);

      if (processedData.length === 0) {
        return NextResponse.json({
          success: true,
          message: '유효한 order_number를 가진 데이터가 없습니다.',
          data: []
        }, { status: 200 });
      }

      const loadTime = Date.now() - startTime;
      console.log(`데이터 로드 완료: ${processedData.length}개 항목, 소요 시간: ${loadTime}ms`);

      return NextResponse.json({
        success: true,
        message: `${processedData.length}개의 데이터를 불러왔습니다.`,
        data: processedData,
        loadTime: loadTime
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
