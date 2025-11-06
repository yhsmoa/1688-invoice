'use client';

import React, { useState, useEffect } from 'react';
import TopsideMenu from '../component/TopsideMenu';
import LeftsideMenu from '../component/LeftsideMenu';
import './index.css';

interface StatsData {
  orderCount: {
    receipt: number;
    completed: number;
    percentage: number;
  };
  totalAmount: {
    receipt: number;
    completed: number;
    percentage: number;
  };
  productCount: {
    receipt: number;
    completed: number;
    percentage: number;
  };
}

const IndexPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsData>({
    orderCount: { receipt: 0, completed: 0, percentage: 0 },
    totalAmount: { receipt: 0, completed: 0, percentage: 0 },
    productCount: { receipt: 0, completed: 0, percentage: 0 }
  });
  const [coupangUsers, setCoupangUsers] = useState<{coupang_name: string, googlesheet_id: string}[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('전체');

  // 쿠팡 사용자 목록 가져오기
  const fetchCoupangUsers = async () => {
    try {
      const response = await fetch('/api/get-coupang-users');
      const result = await response.json();

      if (result.success && result.data) {
        setCoupangUsers(result.data);
      }
    } catch (error) {
      console.error('쿠팡 사용자 목록 가져오기 오류:', error);
    }
  };

  // 통계 데이터 가져오기
  const fetchStats = async () => {
    try {
      const apiUrl = window.location.origin + '/api/get-stats';

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('통계 데이터 가져오기 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchCoupangUsers();
  }, []);

  // 숫자 포맷팅 함수
  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  // 퍼센트 포맷팅 함수
  const formatPercentage = (percentage: number) => {
    return `${percentage.toFixed(1)}%`;
  };

  return (
    <div className="home-layout">
      <TopsideMenu />
      <div className="home-main-content">
        <LeftsideMenu />
        <main className="home-content">
          <div className="home-container">
            <div className="page-header">
              <h1 className="page-title">안녕하세요</h1>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default IndexPage; 