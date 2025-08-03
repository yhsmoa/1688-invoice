'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import './LeftsideMenu.css';

const LeftsideMenu: React.FC = () => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const toggleExportMenu = () => {
    setIsExportMenuOpen(!isExportMenuOpen);
  };

  return (
    <aside className="leftside-menu">
      <nav className="leftside-nav">
        <ul className="menu-list">
          <li className="menu-item">
            <Link href="/import-product" className="menu-link">
              <span className="menu-icon">📦</span>
              <span className="menu-text">상품 입고</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/export-product" className="menu-link">
              <span className="menu-icon">📤</span>
              <span className="menu-text">상품 출고</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/invoice" className="menu-link">
              <span className="menu-icon">📄</span>
              <span className="menu-text">영수증 저장</span>
            </Link>
          </li>
          <li className="menu-item">
            <div className="menu-link" onClick={toggleExportMenu}>
              <span className="menu-icon">📊</span>
              <span className="menu-text">수출 인보이스</span>
              <span className={`dropdown-arrow ${isExportMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isExportMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/export-invoice" className="submenu-link">
                    <span className="submenu-text">인보이스 목록</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/export-invoice/match" className="submenu-link">
                    <span className="submenu-text">인보이스 영수증 매칭</span>
                  </Link>
                </li>
              </ul>
            )}
          </li>
        </ul>
      </nav>
    </aside>
  );
};

export default LeftsideMenu; 