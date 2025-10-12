import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

interface UpdateItem {
  rowId: string;
  field: string;
  value: number | string | null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('=== 배치 저장 API 호출 ===');

    // 요청 본문에서 데이터 추출
    const body = await request.json();
    const { googlesheet_id, coupang_name, updates } = body as {
      googlesheet_id: string;
      coupang_name: string;
      updates: UpdateItem[];
    };

    console.log('요청 데이터:', {
      googlesheet_id,
      coupang_name,
      updates_count: updates?.length
    });

    // 필수 파라미터 검증
    if (!googlesheet_id || !coupang_name || !updates || updates.length === 0) {
      return NextResponse.json({
        success: false,
        error: '필수 파라미터가 누락되었습니다.'
      }, { status: 400 });
    }

    // 서비스 계정 키 검증
    if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
      throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
    }

    // 필드에 따른 구글 시트 열 매핑
    const columnMapping: { [key: string]: string } = {
      'import_qty': 'N',  // N열 - 입고
      'cancel_qty': 'O',  // O열 - 취소
      'note': 'R'         // R열 - 비고
    };

    // JWT 인증 객체 생성
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // 인증
    console.log('JWT 인증 시작...');
    await jwtClient.authorize();
    console.log('JWT 인증 완료');

    // 구글 시트 API 클라이언트 생성
    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // batchUpdate 요청 데이터 준비
    const batchUpdateData: Array<{
      range: string;
      values: any[][];
    }> = [];

    const successDetails: Array<{ rowId: string; field: string; value: any }> = [];
    const failedDetails: Array<{ rowId: string; field: string; error: string }> = [];

    // 각 업데이트 항목에 대해 배치 데이터 생성
    updates.forEach(update => {
      const { rowId, field, value } = update;
      const column = columnMapping[field];

      if (!column) {
        failedDetails.push({
          rowId,
          field,
          error: '지원하지 않는 필드입니다.'
        });
        return;
      }

      const cellAddress = `${SHEET_NAME}!${column}${rowId}`;

      batchUpdateData.push({
        range: cellAddress,
        values: [[value]]
      });

      successDetails.push({ rowId, field, value });
    });

    console.log(`배치 업데이트 준비 완료: ${batchUpdateData.length}개 셀`);

    // 구글 시트 배치 업데이트 실행
    if (batchUpdateData.length > 0) {
      const batchUpdateResult = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: googlesheet_id,
        requestBody: {
          valueInputOption: 'RAW',
          data: batchUpdateData
        }
      });

      console.log('배치 업데이트 완료:', {
        totalUpdatedCells: batchUpdateResult.data.totalUpdatedCells,
        totalUpdatedRows: batchUpdateResult.data.totalUpdatedRows,
      });
    }

    const totalTime = Date.now() - startTime;
    console.log(`전체 처리 시간: ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      message: `${successDetails.length}개의 셀이 성공적으로 저장되었습니다.`,
      details: {
        successCount: successDetails.length,
        failedCount: failedDetails.length,
        totalTime: totalTime,
        successDetails: successDetails,
        failedDetails: failedDetails.length > 0 ? failedDetails : undefined
      }
    });

  } catch (error) {
    console.error('배치 저장 처리 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '배치 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
