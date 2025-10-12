import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

interface VerifyItem {
  rowId: string;
  field: string;
  expectedValue: number | string | null;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('=== 저장 검증 API 호출 ===');

    // 요청 본문에서 데이터 추출
    const body = await request.json();
    const { googlesheet_id, coupang_name, verifications } = body as {
      googlesheet_id: string;
      coupang_name: string;
      verifications: VerifyItem[];
    };

    console.log('검증 요청:', {
      googlesheet_id,
      coupang_name,
      verifications_count: verifications?.length
    });

    // 필수 파라미터 검증
    if (!googlesheet_id || !coupang_name || !verifications || verifications.length === 0) {
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
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    // 인증
    console.log('JWT 인증 시작...');
    await jwtClient.authorize();
    console.log('JWT 인증 완료');

    // 구글 시트 API 클라이언트 생성
    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // 읽어올 셀 범위 준비
    const ranges: string[] = [];
    verifications.forEach(verify => {
      const { rowId, field } = verify;
      const column = columnMapping[field];

      if (column) {
        const cellAddress = `${SHEET_NAME}!${column}${rowId}`;
        ranges.push(cellAddress);
      }
    });

    console.log(`${ranges.length}개 셀 읽기 시작...`);

    // 배치로 셀 값 읽어오기
    const batchGetResult = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: googlesheet_id,
      ranges: ranges,
    });

    console.log('셀 읽기 완료');

    // 검증 결과 분석
    const matches: Array<{ rowId: string; field: string; value: any }> = [];
    const mismatches: Array<{ rowId: string; field: string; expected: any; actual: any }> = [];

    verifications.forEach((verify, index) => {
      const { rowId, field, expectedValue } = verify;

      // 실제 시트에서 읽어온 값
      const valueRange = batchGetResult.data.valueRanges?.[index];
      const actualValue = valueRange?.values?.[0]?.[0] ?? null;

      // 빈 문자열을 null로 처리
      const normalizedActual = actualValue === '' ? null : actualValue;
      const normalizedExpected = expectedValue === '' ? null : expectedValue;

      // 숫자 타입 비교 (문자열로 저장될 수 있음)
      const actualAsString = normalizedActual !== null ? String(normalizedActual) : null;
      const expectedAsString = normalizedExpected !== null ? String(normalizedExpected) : null;

      if (actualAsString === expectedAsString) {
        matches.push({ rowId, field, value: actualValue });
      } else {
        mismatches.push({
          rowId,
          field,
          expected: expectedValue,
          actual: actualValue
        });
      }
    });

    const totalTime = Date.now() - startTime;
    console.log(`검증 완료 시간: ${totalTime}ms`);
    console.log(`일치: ${matches.length}개, 불일치: ${mismatches.length}개`);

    return NextResponse.json({
      success: true,
      allMatch: mismatches.length === 0,
      details: {
        totalChecked: verifications.length,
        matchCount: matches.length,
        mismatchCount: mismatches.length,
        mismatches: mismatches,
        totalTime: totalTime
      }
    });

  } catch (error) {
    console.error('검증 처리 중 오류:', error);
    return NextResponse.json({
      success: false,
      error: '검증 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}
