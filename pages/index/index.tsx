'use client';

import React from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import './index.css';

const IndexPage: React.FC = () => {
  return (
    <div className="home-layout">
      <TopsideMenu />
      <div className="home-main-content">
        <LeftsideMenu />
        <main className="home-content">
          <div className="home-container">
            <h1>안녕하세요</h1>
          </div>
        </main>
      </div>
    </div>
  );
};

export default IndexPage; 