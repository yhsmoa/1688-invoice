'use client';

import React from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';

// ============================================================
// 출퇴근 스캔 페이지 (준비 중)
// 향후 출근/퇴근 스캔 기능 구현 예정
// ============================================================
const AttendanceScanPage: React.FC = () => {
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main style={{ flex: 1, padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#64748b', marginBottom: '8px' }}>출퇴근 스캔</h2>
            <p style={{ fontSize: '14px' }}>준비 중입니다.</p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AttendanceScanPage;
