'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../contexts/LanguageContext';
import { useSidebar } from '../contexts/SidebarContext';
import BarcodePrintModal from './BarcodePrintModal';
import './TopsideMenu.css';

const TopsideMenu: React.FC = () => {
  const { language, changeLanguage } = useLanguage();
  const { toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const isAttendancePage = pathname === '/hr/attendance-scan';
  const isBarcodePage = pathname === '/barcode-scan';
  // [BARCODE] — 바코드 자동 출력 모달 (어느 페이지에서나)
  const [isBarcodePrintOpen, setIsBarcodePrintOpen] = useState(false);

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
          <button
            type="button"
            className={`barcode-print-btn ${isBarcodePrintOpen ? 'active' : ''}`}
            onClick={() => setIsBarcodePrintOpen(true)}
            title="바코드 자동 출력 — QR/바코드 스캔 → 수량 → 출력"
          >
            BARCODE
          </button>
          <Link
            href="/barcode-scan"
            className={`barcode-shortcut-btn ${isBarcodePage ? 'active' : ''}`}
          >
            SHIPMENT
          </Link>
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

      <BarcodePrintModal isOpen={isBarcodePrintOpen} onClose={() => setIsBarcodePrintOpen(false)} />
    </header>
  );
};

export default TopsideMenu;
