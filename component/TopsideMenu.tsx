'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../contexts/LanguageContext';
import { useSidebar } from '../contexts/SidebarContext';
import './TopsideMenu.css';

const TopsideMenu: React.FC = () => {
  const { language, changeLanguage } = useLanguage();
  const { toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const isAttendancePage = pathname === '/hr/attendance-scan';

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    changeLanguage(e.target.value);
  };

  return (
    <header className="topside-menu">
      <div className="topside-content">
        <button className="sidebar-toggle-btn" onClick={toggleSidebar} title="메뉴 토글">
          ☰
        </button>
        <Link href="/" className="topside-title">
          invoice-manager
        </Link>
        <div className="topside-right">
          <Link
            href="/hr/attendance-scan"
            className={`attendance-shortcut-btn ${isAttendancePage ? 'active' : ''}`}
          >
            출퇴근
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
      </div>
    </header>
  );
};

export default TopsideMenu; 