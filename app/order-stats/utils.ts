import { DailyStats, TotalStats, UserStatsData } from './types';

/**
 * 날짜별 통계 데이터에서 전체 합계를 계산하는 함수
 * @param dailyStats 날짜별 통계 데이터 배열
 * @returns 전체 합계 통계
 */
export function calculateTotalStats(dailyStats: DailyStats[]): TotalStats {
  const totalProgress = dailyStats.reduce((sum, item) => sum + item.progress, 0);
  const totalImport = dailyStats.reduce((sum, item) => sum + item.import, 0);
  const totalCancel = dailyStats.reduce((sum, item) => sum + item.cancel, 0);
  const totalExport = dailyStats.reduce((sum, item) => sum + item.export, 0);

  return {
    totalProgress,
    totalImport,
    totalCancel,
    totalExport,
  };
}

/**
 * 여러 사용자의 통계 데이터를 합산하는 함수
 * @param userStatsArray 사용자별 통계 데이터 배열
 * @returns 합산된 전체 통계
 */
export function mergeTotalStats(userStatsArray: UserStatsData[]): TotalStats {
  const totalProgress = userStatsArray.reduce((sum, userData) => sum + userData.totalStats.totalProgress, 0);
  const totalImport = userStatsArray.reduce((sum, userData) => sum + userData.totalStats.totalImport, 0);
  const totalCancel = userStatsArray.reduce((sum, userData) => sum + userData.totalStats.totalCancel, 0);
  const totalExport = userStatsArray.reduce((sum, userData) => sum + userData.totalStats.totalExport, 0);

  return {
    totalProgress,
    totalImport,
    totalCancel,
    totalExport,
  };
}

/**
 * 여러 사용자의 날짜별 통계를 날짜별로 합산하는 함수
 * @param userStatsArray 사용자별 통계 데이터 배열
 * @returns 날짜별로 합산된 통계 데이터 배열 (날짜 오름차순 정렬)
 */
export function mergeDailyStats(userStatsArray: UserStatsData[]): DailyStats[] {
  // 날짜를 키로 하는 Map 생성
  const dateMap = new Map<string, {
    progress: number;
    import: number;
    cancel: number;
    export: number;
  }>();

  // 모든 사용자의 날짜별 통계를 순회하면서 합산
  userStatsArray.forEach(userData => {
    userData.dailyStats.forEach(dailyStat => {
      const existingStat = dateMap.get(dailyStat.date);

      if (existingStat) {
        // 기존 데이터가 있으면 합산 (새 객체로 생성하여 업데이트)
        dateMap.set(dailyStat.date, {
          progress: existingStat.progress + dailyStat.progress,
          import: existingStat.import + dailyStat.import,
          cancel: existingStat.cancel + dailyStat.cancel,
          export: existingStat.export + dailyStat.export,
        });
      } else {
        // 새로운 날짜면 추가
        dateMap.set(dailyStat.date, {
          progress: dailyStat.progress,
          import: dailyStat.import,
          cancel: dailyStat.cancel,
          export: dailyStat.export,
        });
      }
    });
  });

  // Map을 배열로 변환하고 날짜 오름차순으로 정렬
  const mergedStats = Array.from(dateMap.entries()).map(([date, stats]) => ({
    date,
    ...stats,
  })).sort((a, b) => {
    return a.date.localeCompare(b.date);
  });

  return mergedStats;
}

/**
 * 날짜 형식을 MMDD에서 MM/DD로 변환하는 함수
 * @param dateString MMDD 형식의 날짜 문자열
 * @returns MM/DD 형식의 날짜 문자열
 */
export function formatDate(dateString: string): string {
  if (dateString.length !== 4) {
    return dateString;
  }

  const month = dateString.substring(0, 2);
  const day = dateString.substring(2, 4);

  return `${month}/${day}`;
}

/**
 * 숫자를 천 단위 콤마 형식으로 변환하는 함수
 * @param num 숫자
 * @returns 천 단위 콤마가 추가된 문자열
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}
