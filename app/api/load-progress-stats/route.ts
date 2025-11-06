import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// 시트명 고정
const SHEET_NAME = '진행';

// 서비스 계정 키 정보는 환경 변수로 관리
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

/**
 * 진행 시트에서 통계 데이터를 가져오는 API
 *
 * Request Body:
 * - googlesheet_id: 구글 시트 ID
 * - coupang_name: 쿠팡 사용자명 (로깅용)
 *
 * Response:
 * - success: 성공 여부
 * - data: 날짜별 통계 데이터 배열
 *   - date: 날짜 (MMDD 형식)
 *   - progress: 진행 개수 (M열)
 *   - import: 입고 개수 (N열)
 *   - cancel: 취소 개수 (O열)
 *   - export: 출고 개수 (P열)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    console.log('[진행 통계 API] 호출 시작');

    // Request body에서 googlesheet_id와 coupang_name 가져오기
    const body = await request.json();
    const { googlesheet_id, coupang_name } = body;

    if (!googlesheet_id) {
      return NextResponse.json({
        error: '구글 시트 ID가 제공되지 않았습니다.'
      }, { status: 400 });
    }

    console.log(`[진행 통계 API] 구글 시트 ID: ${googlesheet_id}, 사용자: ${coupang_name}`);

    // 구글 시트 API 인증 및 호출
    const jwtClient = new JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    await jwtClient.authorize();
    console.log('[진행 통계 API] 구글 시트 인증 완료');

    const sheets = google.sheets({ version: 'v4', auth: jwtClient });

    // 진행 시트에서 A, M, N, O, P 열만 가져오기
    // A열: date (MMDD), M열: progress, N열: import, O열: cancel, P열: export
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: googlesheet_id,
      range: `${SHEET_NAME}!A:P`, // A부터 P열까지 가져오기
    });

    console.log(`[진행 통계 API] 구글 시트 응답 상태: ${response.status}`);

    if (!response.data || !response.data.values) {
      console.error('[진행 통계 API] 구글 시트에 데이터가 없습니다.');
      return NextResponse.json({
        error: '구글 시트에 데이터가 없습니다.'
      }, { status: 400 });
    }

    const rows = response.data.values;
    console.log(`[진행 통계 API] 총 행 수: ${rows.length}`);

    // 처음 5행 로그 출력 (디버깅용)
    console.log('[진행 통계 API] 처음 5행 샘플:');
    rows.slice(0, 5).forEach((row, index) => {
      console.log(`  행 ${index + 1}: A열="${row[0]}", M열="${row[12]}", N열="${row[13]}", O열="${row[14]}", P열="${row[15]}"`);
    });

    // 헤더 제외 (첫 1행만 헤더로 가정)
    const dataRows = rows.slice(1);
    console.log(`[진행 통계 API] 데이터 행 수 (헤더 제외): ${dataRows.length}`);

    if (dataRows.length === 0) {
      return NextResponse.json({
        success: true,
        message: '데이터가 없습니다.',
        data: []
      }, { status: 200 });
    }

    // 데이터 변환 및 날짜별 그룹화
    // A열(0): date, M열(12): progress, N열(13): import, O열(14): cancel, P열(15): export
    const dateMap = new Map<string, {
      progress: number;
      import: number;
      cancel: number;
      export: number;
    }>();

    // 모든 행을 순회하면서 날짜별로 합산
    dataRows.forEach((row: any[]) => {
      const date = row[0]?.toString().trim() || ''; // A열: 날짜 (MMDD)
      const progress = parseInt(row[12]?.toString() || '0'); // M열: 진행
      const importQty = parseInt(row[13]?.toString() || '0'); // N열: 입고
      const cancel = parseInt(row[14]?.toString() || '0'); // O열: 취소
      const exportQty = parseInt(row[15]?.toString() || '0'); // P열: 출고

      // 날짜가 비어있거나 유효하지 않으면 스킵
      if (!date || date.length !== 4 || isNaN(Number(date))) {
        return;
      }

      // 기존 데이터가 있으면 합산, 없으면 새로 생성
      const existing = dateMap.get(date);
      if (existing) {
        dateMap.set(date, {
          progress: existing.progress + progress,
          import: existing.import + importQty,
          cancel: existing.cancel + cancel,
          export: existing.export + exportQty,
        });
      } else {
        dateMap.set(date, {
          progress,
          import: importQty,
          cancel,
          export: exportQty,
        });
      }
    });

    // Map을 배열로 변환하고 날짜 오름차순으로 정렬
    const statsData = Array.from(dateMap.entries())
      .map(([date, stats]) => ({
        date,
        ...stats,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`[진행 통계 API] 데이터 처리 완료: ${statsData.length}개 날짜, 소요 시간: ${duration}초`);
    console.log('[진행 통계 API] 날짜별 데이터 샘플 (처음 3개):');
    statsData.slice(0, 3).forEach(stat => {
      console.log(`  ${stat.date}: 진행=${stat.progress}, 입고=${stat.import}, 취소=${stat.cancel}, 출고=${stat.export}`);
    });

    return NextResponse.json({
      success: true,
      message: `${coupang_name}의 진행 통계 데이터를 불러왔습니다.`,
      data: statsData,
      loadTime: endTime - startTime,
    }, { status: 200 });

  } catch (error) {
    console.error('[진행 통계 API] 오류 발생:', error);

    return NextResponse.json({
      error: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
    }, { status: 500 });
  }
}
