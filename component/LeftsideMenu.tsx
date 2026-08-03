'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../contexts/LanguageContext';
import { useSaveContext } from '../contexts/SaveContext';
import { useSidebar } from '../contexts/SidebarContext';
import './LeftsideMenu.css';

// ============================================================
// 메뉴 아이콘 — Lucide 스타일 단색 라인 아이콘 (currentColor 상속)
//   컬러 이모지 대신 얇은 아웃라인 아이콘으로 통일
// ============================================================
const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const Icons = {
  // 주문상태 — clipboard-list
  orderStatus: (
    <svg {...iconProps}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" /><path d="M12 16h4" />
      <path d="M8 11h.01" /><path d="M8 16h.01" />
    </svg>
  ),
  // 상품입고 — download(트레이로 내려받기)
  importProduct: (
    <svg {...iconProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  // 상품출고 — upload(트레이에서 내보내기)
  exportProduct: (
    <svg {...iconProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  // 쉽먼트 — truck
  shipment: (
    <svg {...iconProps}>
      <path d="M5 18H3c-.6 0-1-.4-1-1V7c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v11" />
      <path d="M14 9h4l4 4v4c0 .6-.4 1-1 1h-2" />
      <circle cx="7" cy="18" r="2" /><path d="M15 18H9" /><circle cx="17" cy="18" r="2" />
    </svg>
  ),
  // 출고완료 — ship
  shipmentComplete: (
    <svg {...iconProps}>
      <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" />
      <path d="M12 10v4" /><path d="M12 2v3" />
    </svg>
  ),
  // 반품접수 — rotate-ccw(되돌리기)
  returnProduct: (
    <svg {...iconProps}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  ),
  // 계좌관리 — landmark(은행)
  account: (
    <svg {...iconProps}>
      <line x1="3" y1="22" x2="21" y2="22" />
      <line x1="6" y1="18" x2="6" y2="11" /><line x1="10" y1="18" x2="10" y2="11" />
      <line x1="14" y1="18" x2="14" y2="11" /><line x1="18" y1="18" x2="18" y2="11" />
      <polygon points="12 2 20 7 4 7" />
    </svg>
  ),
  // 수출 송장 — file-text
  exportInvoice: (
    <svg {...iconProps}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  // 인사 관리 — users
  hr: (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  // DB 관리 — database
  db: (
    <svg {...iconProps}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
  // V1 — layers
  v1: (
    <svg {...iconProps}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
};

const LeftsideMenu: React.FC = () => {
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isInvoiceMenuOpen, setIsInvoiceMenuOpen] = useState(false);
  const [isHrMenuOpen, setIsHrMenuOpen] = useState(false);
  const [isDbMenuOpen, setIsDbMenuOpen] = useState(false);
  const [isV1MenuOpen, setIsV1MenuOpen] = useState(false);
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

  const toggleHrMenu = () => {
    setIsHrMenuOpen(!isHrMenuOpen);
  };

  const toggleDbMenu = () => {
    setIsDbMenuOpen(!isDbMenuOpen);
  };

  const toggleV1Menu = () => {
    setIsV1MenuOpen(!isV1MenuOpen);
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
          {/* ============================================================ */}
          {/* V2 메뉴 (상단)                                              */}
          {/* ============================================================ */}
          <li className="menu-item">
            <Link href="/order-status-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/order-status-v2')}>
              <span className="menu-icon">{Icons.orderStatus}</span>
              <span className="menu-text">주문상태</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/import-product-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/import-product-v2')}>
              <span className="menu-icon">{Icons.importProduct}</span>
              <span className="menu-text">상품입고</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/export-product-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/export-product-v2')}>
              <span className="menu-icon">{Icons.exportProduct}</span>
              <span className="menu-text">상품출고</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/shipment-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/shipment-v2')}>
              <span className="menu-icon">{Icons.shipment}</span>
              <span className="menu-text">쉽먼트</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/shipment-complete-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/shipment-complete-v2')}>
              <span className="menu-icon">{Icons.shipmentComplete}</span>
              <span className="menu-text">출고완료</span>
            </Link>
          </li>
          <li className="menu-item">
            <Link href="/return-product-v2" className="menu-link" onClick={(e) => handleNavigation(e, '/return-product-v2')}>
              <span className="menu-icon">{Icons.returnProduct}</span>
              <span className="menu-text">반품접수</span>
            </Link>
          </li>

          {/* ============================================================ */}
          {/* 공통 드롭다운 (영수증 저장 / 수출 송장 / 인사 관리)         */}
          {/* ============================================================ */}
          <li className="menu-item">
            <div className="menu-link" onClick={toggleInvoiceMenu}>
              <span className="menu-icon">{Icons.account}</span>
              <span className="menu-text">계좌관리</span>
              <span className={`dropdown-arrow ${isInvoiceMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isInvoiceMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/invoice/payment-history" className="submenu-link" onClick={(e) => handleNavigation(e, '/invoice/payment-history')}>
                    <span className="submenu-text">고객계좌</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/invoice/trade-account" className="submenu-link" onClick={(e) => handleNavigation(e, '/invoice/trade-account')}>
                    <span className="submenu-text">무역계좌</span>
                  </Link>
                </li>
              </ul>
            )}
          </li>
          <li className="menu-item">
            <div className="menu-link" onClick={toggleExportMenu}>
              <span className="menu-icon">{Icons.exportInvoice}</span>
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
                  <Link href="/export-invoice/box-label" className="submenu-link" onClick={(e) => handleNavigation(e, '/export-invoice/box-label')}>
                    <span className="submenu-text">박스 라벨</span>
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
          {/* 인사 관리 (드롭다운) */}
          <li className="menu-item">
            <div className="menu-link" onClick={toggleHrMenu}>
              <span className="menu-icon">{Icons.hr}</span>
              <span className="menu-text">인사 관리</span>
              <span className={`dropdown-arrow ${isHrMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isHrMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/hr/attendance-scan" className="submenu-link" onClick={(e) => handleNavigation(e, '/hr/attendance-scan')}>
                    <span className="submenu-text">출퇴근 스캔</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/hr/employees" className="submenu-link" onClick={(e) => handleNavigation(e, '/hr/employees')}>
                    <span className="submenu-text">직원관리</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/hr/payroll" className="submenu-link" onClick={(e) => handleNavigation(e, '/hr/payroll')}>
                    <span className="submenu-text">급여장부</span>
                  </Link>
                </li>
              </ul>
            )}
          </li>

          {/* DB 관리 (드롭다운) */}
          <li className="menu-item">
            <div className="menu-link" onClick={toggleDbMenu}>
              <span className="menu-icon">{Icons.db}</span>
              <span className="menu-text">DB 관리</span>
              <span className={`dropdown-arrow ${isDbMenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isDbMenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/db/orders" className="submenu-link" onClick={(e) => handleNavigation(e, '/db/orders')}>
                    <span className="submenu-text">주문 데이터 관리</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/db/volume" className="submenu-link" onClick={(e) => handleNavigation(e, '/db/volume')}>
                    <span className="submenu-text">물량관리</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/db/database" className="submenu-link" onClick={(e) => handleNavigation(e, '/db/database')}>
                    <span className="submenu-text">데이터베이스 관리</span>
                  </Link>
                </li>
              </ul>
            )}
          </li>

          {/* ============================================================ */}
          {/* V1 메뉴 (드롭다운, 최하단) — 기존 V1 기능 모음              */}
          {/* ============================================================ */}
          <li className="menu-item">
            <div className="menu-link" onClick={toggleV1Menu}>
              <span className="menu-icon">{Icons.v1}</span>
              <span className="menu-text">V1</span>
              <span className={`dropdown-arrow ${isV1MenuOpen ? 'open' : ''}`}>▼</span>
            </div>
            {isV1MenuOpen && (
              <ul className="submenu-list">
                <li className="submenu-item">
                  <Link href="/order-stats" className="submenu-link" onClick={(e) => handleNavigation(e, '/order-stats')}>
                    <span className="submenu-text">주문 통계</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/chinaorder" className="submenu-link" onClick={(e) => handleNavigation(e, '/chinaorder')}>
                    <span className="submenu-text">{t('menu.chinaOrder')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/order-search" className="submenu-link" onClick={(e) => handleNavigation(e, '/order-search')}>
                    <span className="submenu-text">{t('menu.orderSearch')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/order-check" className="submenu-link" onClick={(e) => handleNavigation(e, '/order-check')}>
                    <span className="submenu-text">{t('menu.orderCheck')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/import-product" className="submenu-link" onClick={(e) => handleNavigation(e, '/import-product')}>
                    <span className="submenu-text">{t('menu.importProduct')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/export-product" className="submenu-link" onClick={(e) => handleNavigation(e, '/export-product')}>
                    <span className="submenu-text">{t('menu.exportProduct')}</span>
                  </Link>
                </li>
                <li className="submenu-item">
                  <Link href="/shipment" className="submenu-link" onClick={(e) => handleNavigation(e, '/shipment')}>
                    <span className="submenu-text">쉽먼트</span>
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
        </ul>
      </nav>
    </aside>
  );
};

export default LeftsideMenu; 