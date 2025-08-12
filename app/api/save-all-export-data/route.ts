import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// 구글 시트 ID와 시트명
const SPREADSHEET_ID = '1yxaocZlgSEUJIurxQHjPNIp6D67frOv9INMeV-XIwP0';
const SHEET_NAME = '주문';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ? 
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

export async function POST(request: NextRequest) {
  try {
    console.log('API 호출: /api/save-all-export-data');
    
    // 1. Supabase에서 export_qty가 있는 모든 데이터 조회
    console.log('export_qty가 있는 데이터 조회 시작');
    const { data: exportData, error: fetchError } = await supabase
      .from('invoice_import_googlesheet')
      .select('row_id, export_qty')
      .not('export_qty', 'is', null)
      .gt('export_qty', 0);
    
    if (fetchError) {
      console.error('데이터 조회 오류:', fetchError);
      return NextResponse.json({ 
        success: false,
        error: '출고 데이터 조회 중 오류가 발생했습니다.', 
        details: fetchError.message 
      }, { status: 500 });
    }

    if (!exportData || exportData.length === 0) {
      console.log('저장할 출고 데이터가 없음');
      return NextResponse.json({ 
        success: true,
        message: '저장할 출고 데이터가 없습니다.',
        updatedCount: 0
      });
    }

    console.log(`${exportData.length}개의 출고 데이터 발견:`, exportData);

    // 2. 구글 시트 업데이트
    try {
      // 서비스 계정 키가 설정되어 있는지 확인
      if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
        throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
      }

      // JWT 인증 객체 생성
      const authClient = new JWT({
        email: SERVICE_ACCOUNT_EMAIL,
        key: PRIVATE_KEY,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      // 구글 스프레드시트 문서 초기화 및 인증
      const doc = new GoogleSpreadsheet(SPREADSHEET_ID, authClient);
      
      // 스프레드시트 로드
      await doc.loadInfo();
      console.log('스프레드시트 로드 완료:', doc.title);
      
      // 시트 가져오기 (이름으로)
      const sheet = doc.sheetsByTitle[SHEET_NAME];
      if (!sheet) {
        throw new Error(`시트 "${SHEET_NAME}"를 찾을 수 없습니다.`);
      }

      console.log('구글 시트 업데이트 시작');
      
      // 각 export_qty 데이터를 구글 시트 W열에 저장
      const updatePromises = exportData.map(async (item) => {
        try {
          const rowIndex = parseInt(item.row_id) - 1; // 0부터 시작하는 인덱스로 변환
          const columnIndex = 'W'.charCodeAt(0) - 'A'.charCodeAt(0); // W열 인덱스
          
          console.log(`행 ${item.row_id} W열에 ${item.export_qty} 저장 중`);
          
          // 해당 셀 로드
          await sheet.loadCells({
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          });
          
          // 셀 값 설정
          const cell = sheet.getCell(rowIndex, columnIndex);
          cell.value = item.export_qty;
          
          return { 
            success: true, 
            row_id: item.row_id, 
            value: item.export_qty 
          };
        } catch (error) {
          console.error(`행 ${item.row_id} 업데이트 오류:`, error);
          return { 
            success: false, 
            row_id: item.row_id, 
            error: error instanceof Error ? error.message : '알 수 없는 오류' 
          };
        }
      });

      const updateResults = await Promise.all(updatePromises);
      
      // 모든 변경사항을 한 번에 저장
      await sheet.saveUpdatedCells();
      console.log('모든 셀 업데이트 완료');
      
      // 성공/실패 카운트
      const successCount = updateResults.filter(result => result.success).length;
      const failCount = updateResults.filter(result => !result.success).length;
      
      console.log(`구글 시트 업데이트 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
      
      if (failCount > 0) {
        const failures = updateResults.filter(result => !result.success);
        console.error('실패한 업데이트:', failures);
      }

      return NextResponse.json({ 
        success: true, 
        message: `${successCount}개의 출고 데이터가 구글 시트에 저장되었습니다.`,
        updatedCount: successCount,
        failedCount: failCount,
        totalCount: exportData.length,
        details: updateResults
      });
      
    } catch (googleError) {
      console.error('구글 시트 업데이트 오류:', googleError);
      
      return NextResponse.json({ 
        success: false, 
        error: '구글 시트 업데이트 중 오류가 발생했습니다.',
        details: googleError instanceof Error ? googleError.message : '알 수 없는 오류',
        dataCount: exportData.length
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('출고 데이터 일괄 저장 처리 중 오류:', error);
    return NextResponse.json({ 
      success: false,
      error: '출고 데이터 일괄 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}