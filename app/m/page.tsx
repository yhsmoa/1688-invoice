'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../contexts/LanguageContext';
import './Mobile.css';

// ============================================================
// /m — 모바일 홈 (휴대폰 작업자용). 메뉴는 앞으로 늘려 간다
//   · 1688 판매자 문의 — 운송장 바코드 촬영 → 미입고 접수에 사진 첨부
// ============================================================
export default function MobileHomePage() {
  const { t } = useTranslation();
  const { language, changeLanguage } = useLanguage();

  return (
    <div className="mob-page">
      <header className="mob-head">
        <div>
          <div className="mob-head-title">invoice-manager</div>
          <div className="mob-head-sub">{t('mobile.subtitle')}</div>
        </div>
        <div className="mob-head-right">
          <select className="mob-lang" value={language} onChange={(e) => changeLanguage(e.target.value)} aria-label="language">
            <option value="ko">한국어</option>
            <option value="zh">中文</option>
          </select>
          <Link href="/" className="mob-back">{t('mobile.toDesktop')}</Link>
        </div>
      </header>

      <main className="mob-body">
        <Link href="/m/seller-inquiry" className="mob-menu-btn">
          <span className="mob-menu-icon" aria-hidden="true">📷</span>
          <span>
            {t('menu.sellerInquiry')}
            <span className="mob-menu-desc">{t('mobile.sellerInquiryDesc')}</span>
          </span>
        </Link>
      </main>
    </div>
  );
}
