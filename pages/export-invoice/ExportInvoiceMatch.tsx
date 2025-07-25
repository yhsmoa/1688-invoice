'use client';

import React from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './ExportInvoiceMatch.css';

const ExportInvoiceMatch: React.FC = () => {
  return (
    <div className="export-match-layout">
      <TopsideMenu />
      <div className="export-match-main-content">
        <LeftsideMenu />
        <main className="export-match-content">
          <div className="export-match-container">
            <h1 className="export-match-title">인보이스 영수증 매칭</h1>
            
            <div className="export-match-content-area">
              <p>인보이스와 영수증을 매칭하는 페이지입니다.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ExportInvoiceMatch; 