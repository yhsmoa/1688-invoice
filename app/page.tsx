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

  // 통계 데이터 가져오기
  const fetchStats = async () => {
    try {
      // 절대 경로 사용
      const apiUrl = window.location.origin + '/api/get-stats';
      console.log('API 호출 URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store'
      });
      
      console.log('API 응답 상태:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('받은 데이터:', data);
        setStats(data);
      } else {
        console.error('API 응답 오류:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('오류 내용:', errorText);
      }
    } catch (error) {
      console.error('통계 데이터 가져오기 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
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
            <div className="stats-card">
              <h2 className="stats-title">주문 통계</h2>
              
              {loading ? (
                <div className="loading">데이터 로딩 중...</div>
              ) : (
                <div className="stats-content">
                  <div className="stats-row">
                    <div className="stats-label">주문개수</div>
                    <div className="stats-values">
                      <div className="stats-value-item">
                        <span className="stats-value-label">영수증 발행:</span>
                        <span className="stats-value-number">{formatNumber(stats.orderCount.receipt)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">거래완료:</span>
                        <span className="stats-value-number">{formatNumber(stats.orderCount.completed)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">달성률:</span>
                        <span className="stats-value-number percentage">{formatPercentage(stats.orderCount.percentage)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="stats-row">
                    <div className="stats-label">총 금액</div>
                    <div className="stats-values">
                      <div className="stats-value-item">
                        <span className="stats-value-label">영수증 발행:</span>
                        <span className="stats-value-number">{formatNumber(stats.totalAmount.receipt)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">거래완료:</span>
                        <span className="stats-value-number">{formatNumber(stats.totalAmount.completed)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">달성률:</span>
                        <span className="stats-value-number percentage">{formatPercentage(stats.totalAmount.percentage)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="stats-row">
                    <div className="stats-label">상품개수</div>
                    <div className="stats-values">
                      <div className="stats-value-item">
                        <span className="stats-value-label">영수증 발행:</span>
                        <span className="stats-value-number">{formatNumber(stats.productCount.receipt)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">거래완료:</span>
                        <span className="stats-value-number">{formatNumber(stats.productCount.completed)}</span>
                      </div>
                      <div className="stats-value-item">
                        <span className="stats-value-label">달성률:</span>
                        <span className="stats-value-number percentage">{formatPercentage(stats.productCount.percentage)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default IndexPage; 