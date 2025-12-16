'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../contexts/LanguageContext';
import { useSaveContext } from '../contexts/SaveContext';
import { useSidebar } from '../contexts/SidebarContext';
import './LeftsideMenu.css';

const LeftsideMenu: React.FC = () => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isInvoiceMenuOpen, setIsInvoiceMenuOpen] = useState(false);
  const { t } = useTranslation();
  const router = useRouter();
  const { checkUnsavedChanges } = useSaveContext();
  const { isSidebarOpen } = useSidebar();

  const toggleExportMenu = () => {
    setIsExportMenuOpen(!isExportMenuOpen);
  };

  const toggleInvoiceMenu = () => {
    setIsInvoiceMenuOpen(!isInvoiceMenuOpen);
  };

  const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    if (checkUnsavedChanges()) {
      router.push(href);
    }
  };

  return (
    <aside className={`leftside-menu ${isSidebarOpen ? 'open' : 'closed'}`}>
      <nav className="leftside-nav">
        <ul className="menu-list">
          <li className="menu-item">
            <Link href="/order-stats" className="menu-link" onClick={(e) => handleNavigation(e, '/order-stats')}>
              <span className="menu-icon">📊</span>
              <span className="menu-text">주문 통계</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/chinaorder" className="menu-link" onClick={(e) => handleNavigation(e, '/chinaorder')}>
              <span className="menu-icon">🛒</span>
              <span className="menu-text">{t('menu.chinaOrder')}</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/order-search" className="menu-link" onClick={(e) => handleNavigation(e, '/order-search')}>
              <span className="menu-icon">🔍</span>
              <span className="menu-text">{t('menu.orderSearch')}</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/order-check" className="menu-link" onClick={(e) => handleNavigation(e, '/order-check')}>
              <span className="menu-icon">✅</span>
              <span className="menu-text">{t('menu.orderCheck')}</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/import-product" className="menu-link" onClick={(e) => handleNavigation(e, '/import-product')}>
              <span className="menu-icon">📦</span>
              <span className="menu-text">{t('menu.importProduct')}</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/export-product" className="menu-link" onClick={(e) => handleNavigation(e, '/export-product')}>
              <span className="menu-icon">📤</span>
              <span className="menu-text">{t('menu.exportProduct')}</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/shipment" className="menu-link" onClick={(e) => handleNavigation(e, '/shipment')}>
              <span className="menu-icon">🚚</span>
              <span className="menu-text">쉽먼트</span>
            </Link>
          </li>
          <li className="menu-item">
            <div className="menu-link" onClick={toggleInvoiceMenu}>
              <span className="menu-icon">📄</span>
              <span className="menu-text">영수증 저장</span>
              <span className={`dropdown-arrow ${isInvoiceMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isInvoiceMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/invoice/payment-history" className="submenu-link" onClick={(e) => handleNavigation(e, '/invoice/payment-history')}>
                    <span className="submenu-text">결제내역</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/invoice/order-refund" className="submenu-link" onClick={(e) => handleNavigation(e, '/invoice/order-refund')}>
                    <span className="submenu-text">주문취소</span>
                  </Link>
                </li>
              </ul>
            )}
          </li>
          <li className="menu-item">
            <div className="menu-link" onClick={toggleExportMenu}>
              <span className="menu-icon">📊</span>
              <span className="menu-text">{t('menu.exportInvoice')}</span>
              <span className={`dropdown-arrow ${isExportMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isExportMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/export-invoice/customs-info" className="submenu-link" onClick={(e) => handleNavigation(e, '/export-invoice/customs-info')}>
                    <span className="submenu-text">{t('menu.customsInfo')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/export-invoice/customs-document" className="submenu-link" onClick={(e) => handleNavigation(e, '/export-invoice/customs-document')}>
                    <span className="submenu-text">{t('menu.customsDocument')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/export-invoice/pdf-split" className="submenu-link" onClick={(e) => handleNavigation(e, '/export-invoice/pdf-split')}>
                    <span className="submenu-text">PDF 분할</span>
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