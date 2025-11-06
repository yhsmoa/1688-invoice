'use client';

import React, { useState, useEffect } from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './order-stats.css';
import { DailyStats, TotalStats, UserStatsData, LoadProgressStatsResponse } from './types';
import { calculateTotalStats, mergeTotalStats, mergeDailyStats, formatDate, formatNumber } from './utils';

const OrderStatsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string}[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('전체');

  // 사용자별 통계 데이터 저장
  const [userStatsMap, setUserStatsMap] = useState<Map<string, UserStatsData>>(new Map());

  // 표시할 통계 데이터 (선택된 사용자에 따라 달라짐)
  const [displayTotalStats, setDisplayTotalStats] = useState<TotalStats>({
    totalProgress: 0,
    totalImport: 0,
    totalCancel: 0,
    totalExport: 0,
  });
  const [displayDailyStats, setDisplayDailyStats] = useState<DailyStats[]>([]);

  /**
   * 쿠팡 사용자 목록 가져오기
   */
  const fetchCoupangUsers = async () => {
    try {
      console.log('[주문통계] 쿠팡 사용자 목록 가져오기 시작...');
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      if (result.success && result.data) {
        setCoupangUsers(result.data);
        console.log(`[주문통계] 쿠팡 사용자 ${result.data.length}명 로드 완료`);
      }
    } catch (error) {
      console.error('[주문통계] 쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  /**
   * 특정 사용자의 진행 통계 데이터를 가져오는 함수
   */
  const fetchUserProgressStats = async (
    coupangName: string,
    googlesheetId: string
  ): Promise<UserStatsData | null> => {
    try {
      console.log(`[주문통계] ${coupangName}의 진행 통계 로딩 시작...`);

      const response = await fetch('/api/load-progress-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          googlesheet_id: googlesheetId,
          coupang_name: coupangName,
        }),
      });

      const result: LoadProgressStatsResponse = await response.json();

      if (result.success && result.data) {
        const dailyStats = result.data;
        const totalStats = calculateTotalStats(dailyStats);

        console.log(`[주문통계] ${coupangName} 데이터 로드 완료: ${dailyStats.length}개 날짜`);

        return {
          coupangName,
          googlesheetId,
          dailyStats,
          totalStats,
        };
      } else {
        console.error(`[주문통계] ${coupangName} 데이터 로드 실패:`, result.error);
        return null;
      }
    } catch (error) {
      console.error(`[주문통계] ${coupangName} 데이터 로드 오류:`, error);
      return null;
    }
  };

  /**
   * 모든 사용자의 진행 통계 데이터를 가져오는 함수
   */
  const fetchAllProgressStats = async () => {
    if (coupangUsers.length === 0) {
      alert('쿠팡 사용자 목록을 먼저 불러와주세요.');
      return;
    }

    try {
      setLoading(true);
      console.log('[주문통계] 전체 사용자 통계 업데이트 시작...');

      // 모든 사용자의 통계를 병렬로 가져오기
      const promises = coupangUsers.map(user =>
        fetchUserProgressStats(user.coupang_name, user.googlesheet_id)
      );

      const results = await Promise.all(promises);

      // null이 아닌 결과만 필터링
      const validResults = results.filter(result => result !== null) as UserStatsData[];

      if (validResults.length === 0) {
        alert('데이터를 불러올 수 없습니다.');
        setLoading(false);
        return;
      }

      // Map으로 저장
      const newUserStatsMap = new Map<string, UserStatsData>();
      validResults.forEach(userData => {
        newUserStatsMap.set(userData.coupangName, userData);
      });

      setUserStatsMap(newUserStatsMap);
      console.log(`[주문통계] ${validResults.length}명의 사용자 데이터 로드 완료`);

      // 전체 통계로 표시 데이터 업데이트
      updateDisplayStats('전체', newUserStatsMap);

      setLoading(false);
      alert('통계 데이터가 업데이트되었습니다.');
    } catch (error) {
      console.error('[주문통계] 전체 통계 업데이트 오류:', error);
      alert('통계 데이터 업데이트 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  /**
   * 표시할 통계 데이터를 업데이트하는 함수
   */
  const updateDisplayStats = (selectedUserName: string, statsMap: Map<string, UserStatsData>) => {
    console.log(`[주문통계] updateDisplayStats 호출: ${selectedUserName}`);
    console.log('[주문통계] statsMap 크기:', statsMap.size);

    if (selectedUserName === '전체') {
      // 전체 선택 시 모든 사용자의 통계를 합산
      const allUserStats = Array.from(statsMap.values());
      const totalStats = mergeTotalStats(allUserStats);
      const dailyStats = mergeDailyStats(allUserStats);

      console.log('[주문통계] 전체 통계 - 날짜 개수:', dailyStats.length);
      setDisplayTotalStats({ ...totalStats });
      setDisplayDailyStats([...dailyStats]);
    } else {
      // 특정 사용자 선택 시 해당 사용자의 통계만 표시
      const userData = statsMap.get(selectedUserName);

      if (userData) {
        console.log(`[주문통계] ${selectedUserName} - 날짜 개수:`, userData.dailyStats.length);
        // 깊은 복사를 통해 원본 데이터 보호
        setDisplayTotalStats({ ...userData.totalStats });
        setDisplayDailyStats(userData.dailyStats.map(stat => ({ ...stat })));
      } else {
        console.warn(`[주문통계] ${selectedUserName}의 데이터가 없습니다.`);
        setDisplayTotalStats({
          totalProgress: 0,
          totalImport: 0,
          totalCancel: 0,
          totalExport: 0,
        });
        setDisplayDailyStats([]);
      }
    }
  };

  /**
   * 사용자 선택 변경 핸들러
   */
  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUser = e.target.value;
    setSelectedUser(newUser);
    updateDisplayStats(newUser, userStatsMap);
  };

  /**
   * 업데이트 버튼 클릭 핸들러
   */
  const handleUpdateClick = () => {
    fetchAllProgressStats();
  };

  useEffect(() => {
    fetchCoupangUsers();
  }, []);

  return (
    <div className="order-stats-layout">
      <TopsideMenu />
      <div className="order-stats-main-content">
        <LeftsideMenu />
        <main className="order-stats-content">
          <div className="order-stats-container">
            <div className="order-stats-page-header">
              <h1 className="order-stats-page-title">주문통계</h1>
              <div className="order-stats-controls">
                <select
                  className="order-stats-user-select-dropdown"
                  value={selectedUser}
                  onChange={handleUserChange}
                >
                  <option value="전체">전체</option>
                  {coupangUsers.map((user) => (
                    <option key={user.coupang_name} value={user.coupang_name}>
                      {user.coupang_name}
                    </option>
                  ))}
                </select>
                <button
                  className="order-stats-update-btn"
                  onClick={handleUpdateClick}
                  disabled={loading}
                >
                  {loading ? '업데이트 중...' : '업데이트'}
                </button>
              </div>
            </div>

            {/* 전체 통계 카드 */}
            <div className="order-stats-card">
              <h2 className="order-stats-title">전체 통계</h2>

              {loading ? (
                <div className="order-stats-loading">데이터 로딩 중...</div>
              ) : (
                <div className="order-stats-content-inner">
                  <div className="order-stats-summary">
                    <div className="order-stats-summary-item">
                      <span className="order-stats-summary-label">진행</span>
                      <span className="order-stats-summary-value">{formatNumber(displayTotalStats.totalProgress)}</span>
                    </div>
                    <div className="order-stats-summary-item">
                      <span className="order-stats-summary-label">입고</span>
                      <span className="order-stats-summary-value">{formatNumber(displayTotalStats.totalImport)}</span>
                    </div>
                    <div className="order-stats-summary-item">
                      <span className="order-stats-summary-label">취소</span>
                      <span className="order-stats-summary-value">{formatNumber(displayTotalStats.totalCancel)}</span>
                    </div>
                    <div className="order-stats-summary-item">
                      <span className="order-stats-summary-label">출고</span>
                      <span className="order-stats-summary-value">{formatNumber(displayTotalStats.totalExport)}</span>
                    </div>
                    <div className="order-stats-summary-item order-stats-summary-item-planned">
                      <span className="order-stats-summary-label">작업예정</span>
                      <span className="order-stats-summary-value">{formatNumber(displayTotalStats.totalProgress - displayTotalStats.totalCancel - displayTotalStats.totalExport)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 날짜별 통계 테이블 */}
            {displayDailyStats.length > 0 && (
              <div className="order-stats-card">
                <h2 className="order-stats-title">날짜별 통계</h2>
                <div className="order-stats-table-container">
                  <table className="order-stats-table">
                    <thead>
                      <tr>
                        <th className="order-stats-th-date">날짜</th>
                        <th className="order-stats-th-progress">진행</th>
                        <th className="order-stats-th-import">입고</th>
                        <th className="order-stats-th-cancel">취소</th>
                        <th className="order-stats-th-export">출고</th>
                        <th className="order-stats-th-planned">작업예정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayDailyStats.map((dayStat) => (
                        <tr key={dayStat.date} className="order-stats-table-row">
                          <td className="order-stats-td-date">{formatDate(dayStat.date)}</td>
                          <td className="order-stats-td-progress">{formatNumber(dayStat.progress)}</td>
                          <td className="order-stats-td-import">{formatNumber(dayStat.import)}</td>
                          <td className="order-stats-td-cancel">{formatNumber(dayStat.cancel)}</td>
                          <td className="order-stats-td-export">{formatNumber(dayStat.export)}</td>
                          <td className="order-stats-td-planned">{formatNumber(dayStat.progress - dayStat.cancel - dayStat.export)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default OrderStatsPage;
