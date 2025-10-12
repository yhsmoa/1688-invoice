'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../contexts/LanguageContext';
import './TopsideMenu.css';

const TopsideMenu: React.FC = () => {
  const { language, changeLanguage } = useLanguage();

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    changeLanguage(e.target.value);
  };

  return (
    <header className="topside-menu">
      <div className="topside-content">
        <Link href="/" className="topside-title">
          invoice-manager
        </Link>
        <div className="language-selector">
          <select
            value={language}
            onChange={handleLanguageChange}
            className="language-dropdown"
          >
            <option value="ko">🇰🇷 한국어</option>
            <option value="zh">🇨🇳 中文</option>
          </select>
        </div>
      </div>
    </header>
  );
};

export default TopsideMenu; 