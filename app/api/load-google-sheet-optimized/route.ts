import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';

// 기본 구글 시트 ID
const DEFAULT_SPREADSHEET_ID = '1yxaocZlgSEUJIurxQHjPNIp6D67frOv9INMeV-XIwP0';
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? 
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

// 캐시 저장소
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30000; // 30초 캐시

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('구글 시트 최적화 API 호출 시작');
    
    // URL 파라미터에서 googlesheet_id 가져오기
    const searchParams = request.nextUrl.searchParams;
    const googleSheetId = searchParams.get('googlesheet_id') || DEFAULT_SPREADSHEET_ID;
    const useCache = searchParams.get('cache') !== 'false'; // 기본적으로 캐시 사용
    
    console.log('구글 시트 ID:', googleSheetId);
    console.log('시트명:', SHEET_NAME);
    
    // 캐시 확인
    if (useCache) {
      const cacheKey = `${googleSheetId}-${SHEET_NAME}`;
      const cached = cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
        console.log('캐시된 데이터 반환');
        return NextResponse.json({ 
          success: true,
          data: cached.data,
          message: `${cached.data.length}개의 데이터를 캐시에서 불러왔습니다.`,
          count: cached.data.length,
          cached: true,
          loadTime: Date.now() - startTime
        });
      }
    }
    
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
      
      // 필요한 컬럼만 지정하여 데이터 가져오기 (A:Q 범위)
      // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15, Q=16
      const range = `${SHEET_NAME}!A:Q`; // A열부터 Q열까지
      
      console.log('구글 시트 데이터 요청 중...');
      const apiStartTime = Date.now();
      
      // 배치 처리를 위한 batchGet 사용
      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: googleSheetId,
        ranges: [range],
        valueRenderOption: 'UNFORMATTED_VALUE', // 빠른 처리를 위해 포맷되지 않은 값 사용
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      
      console.log(`구글 시트 API 응답 시간: ${Date.now() - apiStartTime}ms`);
      
      if (!response.data || !response.data.valueRanges || response.data.valueRanges.length === 0) {
        console.error('구글 시트에 데이터가 없습니다.');
        return NextResponse.json({ 
          error: '구글 시트에 데이터가 없습니다.',
          success: false,
          data: [],
          loadTime: Date.now() - startTime
        }, { status: 200 });
      }

      const valueRange = response.data.valueRanges[0];
      
      if (!valueRange.values || valueRange.values.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '구글 시트에 데이터가 없습니다.',
          loadTime: Date.now() - startTime
        }, { status: 200 });
      }
      
      const rows = valueRange.values;
      console.log('구글 시트 데이터 수신 완료, 행 수:', rows.length);
      
      // 헤더 제외 (첫 1행은 헤더)
      const dataRows = rows.slice(1);
      
      if (dataRows.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '구글 시트에 데이터가 없습니다.',
          loadTime: Date.now() - startTime
        }, { status: 200 });
      }
      
      // 데이터 변환 - 최적화된 처리
      console.log('데이터 변환 시작, 행 수:', dataRows.length);
      const processingStartTime = Date.now();
      
      // 병렬 처리를 위해 배열을 청크로 나누기
      const chunkSize = 50;
      const chunks: any[][] = [];
      
      for (let i = 0; i < dataRows.length; i += chunkSize) {
        chunks.push(dataRows.slice(i, i + chunkSize));
      }
      
      // 각 청크를 병렬로 처리
      const processedChunks = await Promise.all(
        chunks.map(async (chunk, chunkIndex) => {
          return chunk.map((row: any[], rowIndex: number) => {
            const globalIndex = chunkIndex * chunkSize + rowIndex;
            
            // 빈 행 체크 - B열(order_number)이 없고 A열도 없으면 스킵
            if ((!row[1] || row[1].toString().trim() === '') && (!row[0] || row[0].toString().trim() === '')) {
              return null;
            }
            
            return {
              id: uuidv4(),
              row_number: (globalIndex + 2).toString(),
              img_url: row[10] || null, // K열 - 이미지
              order_number_prefix: row[0] || '', // A열 - 글번호 앞부분
              order_number: row[1] || '', // B열 - 글번호 뒷부분
              product_name: row[2] || null, // C열 - 상품명 첫 줄
              product_name_sub: row[3] || null, // D열 - 상품명 둘째 줄
              barcode: row[5] || null, // F열 - 바코드
              china_option1: row[6] || null, // G열 - 주문옵션 첫 줄
              china_option2: row[7] || null, // H열 - 주문옵션 둘째 줄
              order_qty: row[4] ? parseInt(row[4]) : 0, // E열 - 개수
              cost_main: row[8] || null, // I열 - 비용 첫 줄
              cost_sub: row[9] || null, // J열 - 비용 둘째 줄
              progress_qty: row[12] ? parseInt(row[12]) : null, // M열 - 진행
              import_qty: row[13] ? parseInt(row[13]) : null, // N열 - 입고
              cancel_qty: row[14] ? parseInt(row[14]) : null, // O열 - 취소
              export_qty: row[15] ? parseInt(row[15]) : null, // P열 - 출고
              note: row[16] || null, // Q열 - 비고
            };
          }).filter(item => item !== null); // null 값 필터링
        })
      );
      
      // 청크 결과 합치기
      const processedData = processedChunks.flat();
      
      console.log(`데이터 처리 시간: ${Date.now() - processingStartTime}ms`);
      console.log('유효한 데이터 행 수:', processedData.length);
      
      if (processedData.length === 0) {
        return NextResponse.json({ 
          success: true,
          data: [],
          message: '유효한 데이터가 없습니다.',
          loadTime: Date.now() - startTime
        }, { status: 200 });
      }
      
      // 캐시 저장
      if (useCache) {
        const cacheKey = `${googleSheetId}-${SHEET_NAME}`;
        cache.set(cacheKey, {
          data: processedData,
          timestamp: Date.now()
        });
        
        // 오래된 캐시 정리
        for (const [key, value] of cache.entries()) {
          if (Date.now() - value.timestamp > CACHE_DURATION * 2) {
            cache.delete(key);
          }
        }
      }
      
      const totalTime = Date.now() - startTime;
      console.log(`전체 처리 시간: ${totalTime}ms`);
      
      return NextResponse.json({ 
        success: true, 
        data: processedData,
        message: `${processedData.length}개의 데이터를 성공적으로 불러왔습니다.`,
        count: processedData.length,
        loadTime: totalTime,
        apiTime: Date.now() - apiStartTime - processingStartTime,
        processingTime: processingStartTime
      });
      
    } catch (apiError) {
      console.error('구글 시트 API 호출 중 오류:', apiError);
      return NextResponse.json({ 
        error: '구글 시트 API 호출 중 오류가 발생했습니다.',
        details: apiError instanceof Error ? apiError.message : '알 수 없는 오류',
        success: false,
        data: [],
        loadTime: Date.now() - startTime
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('구글 시트 데이터 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '구글 시트 데이터 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류',
      success: false,
      data: [],
      loadTime: Date.now() - startTime
    }, { status: 500 });
  }
}