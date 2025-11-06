/**
 * 날짜별 통계 데이터 타입
 */
export interface DailyStats {
  date: string; // MMDD 형식
  progress: number; // 진행 개수
  import: number; // 입고 개수
  cancel: number; // 취소 개수
  export: number; // 출고 개수
}

/**
 * 전체 통계 데이터 타입
 */
export interface TotalStats {
  totalProgress: number; // 전체 진행 개수
  totalImport: number; // 전체 입고 개수
  totalCancel: number; // 전체 취소 개수
  totalExport: number; // 전체 출고 개수
}

/**
 * 사용자별 통계 데이터 타입
 */
export interface UserStatsData {
  coupangName: string; // 쿠팡 사용자명
  googlesheetId: string; // 구글시트 ID
  dailyStats: DailyStats[]; // 날짜별 통계
  totalStats: TotalStats; // 전체 통계
}

/**
 * API 응답 타입
 */
export interface LoadProgressStatsResponse {
  success: boolean;
  message?: string;
  data: DailyStats[];
  loadTime?: number;
  error?: string;
}
