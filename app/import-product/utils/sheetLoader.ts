/**
 * 구글 시트 데이터 로드 유틸리티
 */

interface LoadSheetParams {
  googlesheetId: string;
  coupangName: string;
}

interface LoadSheetResult {
  success: boolean;
  data?: any[];
  message?: string;
  error?: string;
  details?: string;
  loadTime?: number;
}

/**
 * 구글 시트 데이터를 서버에서 로드
 */
export async function loadGoogleSheetData(
  params: LoadSheetParams
): Promise<LoadSheetResult> {
  const { googlesheetId, coupangName } = params;

  try {
    // 최적화된 API 엔드포인트 사용 - 캐시 비활성화
    const response = await fetch(
      `/api/load-google-sheet-optimized?googlesheet_id=${googlesheetId}&coupang_name=${encodeURIComponent(coupangName)}&cache=false`,
      {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
      }
    );

    let result;
    try {
      result = await response.json();
      console.log('구글 시트 API 응답:', result);
    } catch (parseError: any) {
      const errorText = await response.text();
      console.error('응답 파싱 오류:', parseError);
      console.error('원본 응답 텍스트:', errorText);
      throw new Error('API 응답을 파싱할 수 없습니다.');
    }

    if (response.ok && result.success) {
      return {
        success: true,
        data: result.data || [],
        message: result.message,
        loadTime: result.loadTime,
      };
    } else {
      const errorMessage =
        result.error || result.details || '구글 시트 데이터를 불러오는데 실패했습니다.';
      console.error('구글 시트 API 오류:', errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (error) {
    console.error('구글 시트 데이터 불러오기 오류:', error);
    return {
      success: false,
      error: `구글 시트 데이터를 불러오는데 실패했습니다: ${
        error instanceof Error ? error.message : '알 수 없는 오류'
      }`,
    };
  }
}

/**
 * localStorage에 구글 시트 데이터 캐시
 */
export function saveToCache(
  coupangName: string,
  data: any[],
  googlesheetId?: string,
  userId?: string
) {
  const cacheKey = `sheet_data_${coupangName}`;
  const cacheData = {
    data: data,
    timestamp: Date.now(),
    coupangName: coupangName,
    googlesheet_id: googlesheetId,
    user_id: userId,
  };

  try {
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch (error) {
    console.error('캐시 저장 오류:', error);
    // localStorage가 가득 차면 오래된 캐시 삭제
    try {
      const keys = Object.keys(localStorage);
      const sheetDataKeys = keys.filter((key) => key.startsWith('sheet_data_'));
      if (sheetDataKeys.length > 0) {
        // 가장 오래된 캐시 삭제
        localStorage.removeItem(sheetDataKeys[0]);
        // 다시 시도
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
      }
    } catch (e) {
      console.error('캐시 정리 실패:', e);
    }
  }
}

/**
 * localStorage에서 구글 시트 캐시 데이터 로드
 */
export function loadFromCache(coupangName: string): any[] | null {
  try {
    const cacheKey = `sheet_data_${coupangName}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
      const parsedData = JSON.parse(cachedData);
      console.log(`${coupangName}의 캐시된 데이터를 불러왔습니다.`);
      return parsedData.data || [];
    }
  } catch (error) {
    console.error('캐시 데이터 로드 오류:', error);
  }
  return null;
}

/**
 * 캐시 데이터 존재 여부 확인
 */
export function hasCachedData(coupangName: string): boolean {
  const cacheKey = `sheet_data_${coupangName}`;
  return localStorage.getItem(cacheKey) !== null;
}
