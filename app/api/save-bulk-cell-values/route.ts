import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

interface BulkUpdateRequest {
  updates: Array<{
    row_id: string;
    field: string;
    value: number | string | null;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    console.log('API 호출: /api/save-bulk-cell-values');

    // 요청 본문에서 데이터 추출
    const body: BulkUpdateRequest = await request.json();
    const { updates } = body;

    console.log('요청 데이터:', { updateCount: updates.length });

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({
        error: '업데이트할 데이터가 없습니다.'
      }, { status: 400 });
    }

    // 필수 파라미터 검증
    for (const update of updates) {
      if (!update.row_id || !update.field) {
        return NextResponse.json({
          error: '필수 파라미터가 누락되었습니다.',
          details: 'row_id와 field는 필수입니다.'
        }, { status: 400 });
      }
    }

    // 1. 첫 번째 row_id로 구글시트 정보 조회
    const firstUpdate = updates[0];
    const { data: rowData, error: selectError } = await supabase
      .from('invoice_import_googlesheet')
      .select('googlesheet_id, coupang_name')
      .eq('row_id', firstUpdate.row_id)
      .single();

    if (selectError || !rowData) {
      console.error('구글시트 정보를 찾을 수 없습니다:', selectError);
      return NextResponse.json({
        error: '구글시트 정보를 찾을 수 없습니다.',
        details: selectError?.message
      }, { status: 404 });
    }

    const { googlesheet_id, coupang_name } = rowData;
    console.log(`구글시트 ID: ${googlesheet_id}, 사용자: ${coupang_name}`);

    // 2. Supabase 일괄 업데이트
    console.log('Supabase 일괄 업데이트 시작');
    const supabaseResults = [];

    for (const update of updates) {
      const { data: updatedData, error: updateError } = await supabase
        .from('invoice_import_googlesheet')
        .update({ [update.field]: update.value })
        .eq('row_id', update.row_id)
        .select('row_id, ' + update.field);

      if (updateError) {
        console.error(`Supabase 업데이트 오류 (row_id: ${update.row_id}):`, updateError);
        supabaseResults.push({
          row_id: update.row_id,
          success: false,
          error: updateError.message
        });
      } else {
        console.log(`Supabase 업데이트 성공 (row_id: ${update.row_id})`);
        supabaseResults.push({
          row_id: update.row_id,
          success: true,
          data: updatedData
        });
      }
    }

    console.log(`Supabase 업데이트 완료: ${supabaseResults.filter(r => r.success).length}/${updates.length}`);

    // 3. 구글 시트 일괄 업데이트
    const googleSheetResults = [];

    try {
      // 서비스 계정 키가 설정되어 있는지 확인
      if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
        throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
      }

      // 필드에 따른 구글 시트 열 매핑
      const columnMapping: { [key: string]: string } = {
        'import_qty': 'N',  // N열 - 입고
        'cancel_qty': 'O',  // O열 - 취소
        'note': 'Q'         // Q열 - 비고
      };

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

      // batchUpdate 요청을 위한 데이터 준비
      const batchUpdateData = [];

      for (const update of updates) {
        const column = columnMapping[update.field];

        if (!column) {
          console.warn(`${update.field}에 대한 구글 시트 열 매핑이 없습니다. (row_id: ${update.row_id})`);
          googleSheetResults.push({
            row_id: update.row_id,
            success: false,
            error: '지원하지 않는 필드입니다.'
          });
          continue;
        }

        const cellAddress = `${SHEET_NAME}!${column}${update.row_id}`;
        batchUpdateData.push({
          range: cellAddress,
          values: [[update.value]]
        });
      }

      if (batchUpdateData.length > 0) {
        console.log(`구글 시트 일괄 업데이트 시작: ${batchUpdateData.length}개 셀`);

        // batchUpdate 실행
        const batchResponse = await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: googlesheet_id,
          requestBody: {
            valueInputOption: 'RAW',
            data: batchUpdateData
          }
        });

        console.log('구글 시트 일괄 업데이트 완료:', batchResponse.data);

        // 성공한 업데이트들 기록
        updates.forEach((update, index) => {
          const column = columnMapping[update.field];
          if (column) {
            googleSheetResults.push({
              row_id: update.row_id,
              success: true,
              range: `${SHEET_NAME}!${column}${update.row_id}`,
              value: update.value
            });
          }
        });
      }

    } catch (googleError) {
      console.error('구글 시트 업데이트 오류:', googleError);

      // 모든 업데이트에 대해 실패 기록
      updates.forEach(update => {
        const column = columnMapping[update.field];
        if (column) {
          googleSheetResults.push({
            row_id: update.row_id,
            success: false,
            error: googleError instanceof Error ? googleError.message : '알 수 없는 오류'
          });
        }
      });
    }

    // 4. 결과 정리
    const successCount = supabaseResults.filter(r => r.success).length;
    const googleSuccessCount = googleSheetResults.filter(r => r.success).length;

    const response = {
      success: successCount > 0,
      message: `총 ${updates.length}개 중 Supabase: ${successCount}개, 구글시트: ${googleSuccessCount}개 업데이트 완료`,
      summary: {
        total: updates.length,
        supabaseSuccess: successCount,
        googleSheetSuccess: googleSuccessCount,
        spreadsheetId: googlesheet_id,
        coupang_name: coupang_name
      },
      results: {
        supabase: supabaseResults,
        googleSheet: googleSheetResults
      }
    };

    // 부분 성공인 경우 경고, 전체 실패인 경우 에러
    const statusCode = successCount === updates.length ? 200 :
                      successCount > 0 ? 207 : 400;

    return NextResponse.json(response, { status: statusCode });

  } catch (error) {
    console.error('일괄 셀 값 저장 처리 중 오류:', error);
    return NextResponse.json({
      error: '일괄 셀 값 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}