


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

export async function POST(request: NextRequest) {
  try {
    console.log('=== API 호출: /api/save-cell-value ===');
    console.log('Request URL:', request.url);
    console.log('Request Headers:', Object.fromEntries(request.headers));

    // 요청 본문에서 데이터 추출
    const body = await request.json();
    const { order_number, barcode, field, value, googlesheet_id, coupang_name } = body;

    console.log('요청 데이터:', JSON.stringify(body, null, 2));

    if (!order_number || !barcode || !field) {
      console.error('필수 파라미터 누락:', { order_number, barcode, field });
      return NextResponse.json({
        error: '필수 파라미터가 누락되었습니다. (order_number, barcode, field 필요)'
      }, { status: 400 });
    }

    console.log(`셀 값 저장 요청: order_number=${order_number}, barcode=${barcode}, field=${field}, value=${value}`);

    // 1. 필수 파라미터 체크
    if (!googlesheet_id || !coupang_name) {
      console.error('필수 파라미터 누락: googlesheet_id 또는 coupang_name');
      return NextResponse.json({
        error: '구글시트 ID 또는 사용자명이 누락되었습니다.'
      }, { status: 400 });
    }
    console.log(`구글시트 ID: ${googlesheet_id}, 사용자: ${coupang_name}`);

    // 2. 구글 시트 업데이트
    try {
      console.log('환경변수 확인:');
      console.log('SERVICE_ACCOUNT_EMAIL:', SERVICE_ACCOUNT_EMAIL ? '설정됨' : '누락');
      console.log('PRIVATE_KEY:', PRIVATE_KEY ? '설정됨' : '누락');

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
      console.log('JWT 인증 시작...');
      await jwtClient.authorize();
      console.log('JWT 인증 완료');

      // 구글 시트 API 클라이언트 생성
      const sheets = google.sheets({ version: 'v4', auth: jwtClient });

      // 전체 시트 데이터 가져오기 (B열=주문번호, F열=바코드)
      console.log('구글 시트에서 주문번호와 바코드로 행 찾기...');
      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: googlesheet_id,
        range: `${SHEET_NAME}!B:F`, // B열(주문번호)부터 F열(바코드)까지
      });

      const rows = sheetData.data.values;
      if (!rows || rows.length === 0) {
        throw new Error('구글 시트에 데이터가 없습니다.');
      }

      // 주문번호(B열, index 0)와 바코드(F열, index 4)가 일치하는 행 찾기
      let targetRowNumber = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sheetOrderNumber = row[0]?.toString().trim() || ''; // B열
        const sheetBarcode = row[4]?.toString().trim() || '';     // F열

        if (sheetOrderNumber === order_number.toString().trim() &&
            sheetBarcode === barcode.toString().trim()) {
          targetRowNumber = i + 1; // 1-based index
          console.log(`일치하는 행 발견: ${targetRowNumber}번째 행`);
          break;
        }
      }

      if (targetRowNumber === -1) {
        throw new Error(`주문번호(${order_number})와 바코드(${barcode})가 일치하는 행을 찾을 수 없습니다.`);
      }

      // 필드에 따른 구글 시트 열 매핑
      const columnMapping: { [key: string]: string } = {
        'import_qty': 'N',  // N열 - 입고
        'cancel_qty': 'O',  // O열 - 취소
        'note': 'R'         // R열 - 비고
      };

      const column = columnMapping[field];

      if (!column) {
        console.warn(`${field}에 대한 구글 시트 열 매핑이 없습니다.`);
        return NextResponse.json({
          success: false,
          message: '지원하지 않는 필드입니다.',
          field: field
        });
      }

      // 셀 주소 생성 (예: N2, O5, R10)
      const cellAddress = `${SHEET_NAME}!${column}${targetRowNumber}`;

      console.log(`구글 시트 셀 업데이트 준비:`);
      console.log(`- Spreadsheet ID: ${googlesheet_id}`);
      console.log(`- Cell Address: ${cellAddress}`);
      console.log(`- Value: ${value}`);

      // 셀 값 업데이트
      const updateResult = await sheets.spreadsheets.values.update({
        spreadsheetId: googlesheet_id,
        range: cellAddress,
        valueInputOption: 'RAW', // 원시 값 입력
        requestBody: {
          values: [[value]]
        }
      });

      console.log('구글 시트 업데이트 완료');
      console.log('업데이트 결과:', JSON.stringify(updateResult.data, null, 2));

      return NextResponse.json({
        success: true,
        message: '데이터가 성공적으로 저장되었습니다.',
        sheetUpdate: {
          spreadsheetId: googlesheet_id,
          range: cellAddress,
          value: value,
          coupang_name: coupang_name,
          foundRowNumber: targetRowNumber
        }
      });

    } catch (googleError) {
      console.error('구글 시트 업데이트 오류:', googleError);

      // 구글 시트 업데이트 실패
      return NextResponse.json({
        success: false,
        message: '구글 시트 업데이트에 실패했습니다.',
        googleError: googleError instanceof Error ? googleError.message : '알 수 없는 오류'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('셀 값 저장 처리 중 오류:', error);
    return NextResponse.json({
      error: '셀 값 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
} 