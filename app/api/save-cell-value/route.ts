


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
    console.log('API 호출: /api/save-cell-value');
    
    // 요청 본문에서 데이터 추출
    const body = await request.json();
    const { row_id, field, value } = body;
    
    console.log('요청 데이터:', body);
    
    if (!row_id || !field) {
      console.error('필수 파라미터 누락:', { row_id, field });
      return NextResponse.json({ 
        error: '필수 파라미터가 누락되었습니다.' 
      }, { status: 400 });
    }
    
    console.log(`셀 값 저장 요청: row_id=${row_id}, field=${field}, value=${value}`);
    
    // 1. Supabase 데이터베이스 업데이트
    console.log('Supabase 업데이트 시작');
    const { data: updatedData, error: updateError } = await supabase
      .from('invoice_import_googlesheet')
      .update({ [field]: value })
      .eq('row_id', row_id)
      .select();
    
    if (updateError) {
      console.error('Supabase 업데이트 오류:', updateError);
      return NextResponse.json({ 
        error: '데이터 저장 중 오류가 발생했습니다.', 
        details: updateError.message 
      }, { status: 500 });
    }
    
    console.log('Supabase 데이터 업데이트 완료, 결과:', updatedData);
    
    if (!updatedData || updatedData.length === 0) {
      console.warn(`row_id=${row_id}에 해당하는 데이터가 없습니다.`);
      return NextResponse.json({ 
        warning: `row_id=${row_id}에 해당하는 데이터가 없습니다.`,
        success: false
      }, { status: 404 });
    }
    
    // 2. 구글 시트 업데이트
    try {
      // 서비스 계정 키가 설정되어 있는지 확인
      if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
        throw new Error('구글 서비스 계정 정보가 설정되지 않았습니다.');
      }

      // 필드에 따른 구글 시트 열 매핑
      const columnMapping: { [key: string]: string } = {
        'import_qty': 'U', // 입고수량은 U열
        'confirm_qty': 'V', // 확인수량은 V열
        'cancel_qty': 'W'   // 취소수량은 W열
      };
      
      const column = columnMapping[field];
      
      if (!column) {
        console.warn(`${field}에 대한 구글 시트 열 매핑이 없습니다.`);
        return NextResponse.json({ 
          success: true, 
          message: 'Supabase 데이터만 업데이트되었습니다.',
          data: updatedData
        });
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
      
      // 행 번호 (0부터 시작하는 인덱스로 변환)
      const rowIndex = parseInt(row_id) - 1;
      
      // 열 인덱스 계산 (A=0, B=1, ...)
      const columnIndex = column.charCodeAt(0) - 'A'.charCodeAt(0);
      
      // 셀 업데이트
      console.log(`셀 업데이트: 행=${rowIndex}, 열=${column}(${columnIndex}), 값=${value}`);
      
      // 행 로드
      await sheet.loadCells({
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      });
      
      // 셀 값 설정
      const cell = sheet.getCell(rowIndex, columnIndex);
      cell.value = value;
      
      // 변경사항 저장
      await sheet.saveUpdatedCells();
      
      console.log('구글 시트 업데이트 완료');
      
      return NextResponse.json({ 
        success: true, 
        message: '데이터가 성공적으로 저장되었습니다.',
        data: updatedData,
        sheetUpdate: {
          row: row_id,
          column,
          value
        }
      });
      
    } catch (googleError) {
      console.error('구글 시트 업데이트 오류:', googleError);
      
      // 구글 시트 업데이트 실패해도 Supabase 업데이트는 성공했으므로 성공 응답
      return NextResponse.json({ 
        success: true, 
        message: 'Supabase 데이터는 업데이트되었지만 구글 시트 업데이트에 실패했습니다.',
        googleError: googleError instanceof Error ? googleError.message : '알 수 없는 오류',
        data: updatedData
      });
    }
    
  } catch (error) {
    console.error('셀 값 저장 처리 중 오류:', error);
    return NextResponse.json({ 
      error: '셀 값 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 