import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

export async function POST(request: NextRequest) {
  try {
    console.log('=== API 호출: /api/save-label-data ===');

    // 요청 본문에서 데이터 추출
    const body = await request.json();
    const { labelData, googlesheet_id, coupang_name, targetSheet } = body;

    // 시트명 동적 선택 (기본값: LABEL)
    const SHEET_NAME = targetSheet || 'LABEL';

    // 1. 필수 파라미터 체크
    if (!googlesheet_id || !coupang_name || !labelData || !Array.isArray(labelData)) {
      console.error('필수 파라미터 누락');
      return NextResponse.json({
        error: '필수 파라미터가 누락되었습니다.'
      }, { status: 400 });
    }

    console.log(`${SHEET_NAME} 저장: ${labelData.length}개 아이템`);

    // 2. 구글 시트에 데이터 저장
    try {
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
      await jwtClient.authorize();

      // 구글 시트 API 클라이언트 생성
      const sheets = google.sheets({ version: 'v4', auth: jwtClient });

      // 기존 데이터 초기화 (최적화된 방식) - H열까지 확장
      try {
        // 고정된 범위로 빠르게 초기화 (A2:H1000)
        await sheets.spreadsheets.values.clear({
          spreadsheetId: googlesheet_id,
          range: `${SHEET_NAME}!A2:H1000`
        });
      } catch (clearError) {
        // 에러 무시하고 계속 진행
      }

      // 헤더 설정 (1행)
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId: googlesheet_id,
          range: `${SHEET_NAME}!A1:H1`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [['브랜드', '상품명', '바코드', '수량', '주문번호', '혼용률', '추천연령', '입고사이즈']]
          }
        });
      } catch (headerError) {
        console.warn('헤더 설정 실패:', headerError);
      }

      // 새로운 데이터 준비 - F열, G열 수식 추가, H열 사이즈 코드 추가
      const values = labelData.map((item: any, index: number) => [
        coupang_name,           // A열: 브랜드
        item.name || '',        // B열: 상품명
        item.barcode || '',     // C열: 바코드
        item.qty || 0,          // D열: 수량
        item.order_number || '', // E열: 주문번호
        `=XLOOKUP(LEFT(E${index + 2},14),'진행'!B:B,'진행'!W:W,"",0)`, // F열: 혼용률 수식 (E열에서 앞 14자리만 사용)
        `=XLOOKUP(LEFT(E${index + 2},14),'진행'!B:B,'진행'!X:X,"",0)`, // G열: 추천연령 수식 (E열에서 앞 14자리만 사용)
        item.sizeCode || ''     // H열: 사이즈 코드 (A, B, C, P, X)
      ]);

      // LABEL 시트에 데이터 추가 (2행부터) - H열까지 확장
      const range = `${SHEET_NAME}!A2:H${values.length + 1}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId: googlesheet_id,
        range: range,
        valueInputOption: 'USER_ENTERED', // 수식이 계산되도록 변경
        requestBody: {
          values: values
        }
      });

      return NextResponse.json({
        success: true,
        message: `${SHEET_NAME} 시트에 ${values.length}개 데이터가 저장되었습니다.`,
        count: values.length,
        sheetUpdate: {
          spreadsheetId: googlesheet_id,
          range: range,
          sheetName: SHEET_NAME,
          coupang_name: coupang_name
        }
      });

    } catch (googleError) {
      console.error('구글 시트 업데이트 오류:', googleError);
      return NextResponse.json({
        success: false,
        message: '구글 시트 업데이트에 실패했습니다.',
        error: googleError instanceof Error ? googleError.message : '알 수 없는 오류'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('LABEL 데이터 저장 처리 중 오류:', error);
    return NextResponse.json({
      error: 'LABEL 데이터 저장 처리 중 오류가 발생했습니다.',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 });
  }
}