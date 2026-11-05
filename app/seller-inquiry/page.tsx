'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';

// ============================================================
// 1688 판매자 문의 — 자리만 잡아 둔 페이지 (기능은 이후 작업에서)
//   메뉴: 상품문의 › 1688 판매자 문의
// ============================================================
export default function SellerInquiryPage() {
  const { t } = useTranslation();
  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main style={{ flex: 1, padding: '40px 32px' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{t('menu.sellerInquiry')}</h1>
          <p style={{ marginTop: 12, color: '#6b7280' }}>{t('sellerInquiry.comingSoon')}</p>
        </main>
      </div>
    </div>
  );
}
