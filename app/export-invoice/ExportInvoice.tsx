'use client';

import React from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './ExportInvoice.css';

const ExportInvoice: React.FC = () => {
  return (
    <div className="export-layout">
      <TopsideMenu />
      <div className="export-main-content">
        <LeftsideMenu />
        <main className="export-content">
          <div className="export-container">
            <h1 className="export-title">인보이스 목록</h1>
            
            <div className="export-content-area">
              <p>수출 인보이스 목록 관리 페이지입니다.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ExportInvoice; 