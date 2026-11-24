'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../contexts/LanguageContext';
import './Mobile.css';

// ============================================================
// /m — 모바일 홈 (휴대폰 작업자용). 메뉴는 앞으로 늘려 간다
//   · 1688 판매자 문의 — 운송장 바코드 촬영 → 미입고 접수에 사진 첨부
//   · 와우출고 작업 — 박스 라벨 촬영 → 카드를 넘기며 찾음 · 부족 표시 → 작업완료
//   · 재고 배치 — 주문번호 라벨 촬영 → 위치 · 수량 입력 → 배치 (PC 재고 › [작업중] 과 같은 일)
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
        <Link href="/m/wow" className="mob-menu-btn">
          <span className="mob-menu-icon" aria-hidden="true">📦</span>
          <span>
            {t('menu.wowWork')}
            <span className="mob-menu-desc">{t('mobile.wowDesc')}</span>
          </span>
        </Link>
        <Link href="/m/putaway" className="mob-menu-btn">
          <span className="mob-menu-icon" aria-hidden="true">🗄️</span>
          <span>
            {t('menu.putawayWork')}
            <span className="mob-menu-desc">{t('mobile.putawayDesc')}</span>
          </span>
        </Link>
      </main>
    </div>
  );
}
