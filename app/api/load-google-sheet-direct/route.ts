import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? 
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

export async function GET(request: NextRequest) {
  try {
    console.log('구글 시트 직접 로드 API 호출 시작');
    
    // URL 파라미터에서 googlesheet_id 가져오기 (필수)
    const searchParams = request.nextUrl.searchParams;
    const googleSheetId = searchParams.get('googlesheet_id');

    // googlesheet_id가 없으면 에러 반환
    if (!googleSheetId) {
      console.error('googlesheet_id 파라미터가 필요합니다.');
      return NextResponse.json({
        error: 'googlesheet_id 파라미터가 필요합니다. users_api 테이블에서 사용자를 선택해주세요.',
        success: false,
        data: []
      }, { status: 400 });
    }
    
    console.log('구글 시트 ID:', googleSheetId);
    console.log('시트명:', SHEET_NAME);
    
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
          error: '구글 시트에 데이터가 없습니다.',
          success: false,
          data: []
        }, { status: 200 });
      }

      const data = response.data;
      console.log('구글 시트 데이터 수신 완료, 행 수:', data.values?.length || 0);
      
      if (!data.values || data.values.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '구글 시트에 데이터가 없습니다.'
        }, { status: 200 });
      }
      
      const rows = data.values;
      
      // 헤더 제외 (첫 1행은 헤더)
      const dataRows = rows.slice(1);
      
      if (dataRows.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '구글 시트에 데이터가 없습니다.'
        }, { status: 200 });
      }
      
      // 데이터 변환 - 새로운 컬럼 매핑
      console.log('데이터 변환 시작, 행 수:', dataRows.length);
      const processedData = dataRows.map((row: any[], index: number) => {
        try {
          // 각 컬럼 인덱스 (0-based)
          // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10
          
          return {
            id: uuidv4(), // 고유 ID 생성
            row_number: (index + 2).toString(), // 구글 시트 행 번호 (헤더 1줄 + 1부터 시작)
            img_url: row[10] || null, // K열 (인덱스 10) - 이미지
            order_number: row[1] || '', // B열 (인덱스 1) - 글번호
            product_name: row[2] || null, // C열 (인덱스 2) - 상품명 첫 줄
            product_name_sub: row[3] || null, // D열 (인덱스 3) - 상품명 둘째 줄
            china_option1: row[6] || null, // G열 (인덱스 6) - 주문옵션 첫 줄
            china_option2: row[7] || null, // H열 (인덱스 7) - 주문옵션 둘째 줄
            order_qty: parseInt(row[4]) || 0, // E열 (인덱스 4) - 개수
            cost_main: row[8] || null, // I열 (인덱스 8) - 비용 첫 줄
            cost_sub: row[9] || null, // J열 (인덱스 9) - 비용 둘째 줄
            // 입고, 확인, 취소, 출고는 빈 값으로 초기화
            import_qty: null,
            confirm_qty: null,
            cancel_qty: null,
            export_qty: null,
          };
        } catch (error) {
          console.error(`행 ${index + 2} 처리 중 오류:`, error, '행 데이터:', row);
          return {
            id: uuidv4(),
            row_number: (index + 2).toString(),
            order_number: row[1] || `오류_행_${index + 2}`,
            product_name: '데이터 처리 중 오류 발생',
            product_name_sub: null,
            china_option1: null,
            china_option2: null,
            order_qty: 0,
            cost_main: null,
            cost_sub: null,
            img_url: null,
            import_qty: null,
            confirm_qty: null,
            cancel_qty: null,
            export_qty: null,
          };
        }
      });
      
      console.log('데이터 변환 완료, 처리된 행 수:', processedData.length);
      
      // 빈 order_number 필터링
      const filteredData = processedData.filter((item: any) => item.order_number && item.order_number.trim() !== '');
      console.log('유효한 order_number를 가진 행 수:', filteredData.length);
      
      if (filteredData.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '유효한 order_number를 가진 데이터가 없습니다.'
        }, { status: 200 });
      }
      
      return NextResponse.json({ 
        success: true, 
        data: filteredData,
        message: `${filteredData.length}개의 데이터를 성공적으로 불러왔습니다.`,
        count: filteredData.length
      });
      
    } catch (apiError) {
      console.error('구글 시트 API 호출 중 오류:', apiError);
      return NextResponse.json({ 
        error: '구글 시트 API 호출 중 오류가 발생했습니다.',
        details: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        success: false,
        data: []
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('구글 시트 데이터 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '구글 시트 데이터 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류',
      success: false,
      data: []
    }, { status: 500 });
  }
}