'use client';

import React from 'react';
import Link from 'next/link';
import './TopsideMenu.css';

const TopsideMenu: React.FC = () => {
  return (
    <header className="topside-menu">
      <div className="topside-content">
        <Link href="/" className="topside-title">
          invoice-manager
        </Link>
      </div>
    </header>
  );
};

export default TopsideMenu; 