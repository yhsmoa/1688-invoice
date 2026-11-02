'use client';

import React from 'react';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { StorageProvider } from './hooks/StorageContext';
import StorageHeader from './components/StorageHeader';
import './Storage.css';

// ============================================================
// /storage 레이아웃 — 재고(보관)
//
//   [작업중] /storage/pending : 보관 상품 입고분 → 위치 배치(PUTAWAY)
//   [재고]   /storage/stock   : 위치별 재고 → 쉽먼트(PICK + PACKED) · 위치 이동
//   사용자·담당자 선택과 두 목록은 StorageProvider 가 들고, 탭을 옮겨도 유지된다.
//   설계: docs/PLAN_stock-type-S.md · DB: supabase/storage/001_storage.sql
// ============================================================
export default function StorageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="storage-layout">
      <TopsideMenu />
      <div className="storage-main-content">
        <LeftsideMenu />
        <main className="storage-content">
          <StorageProvider>
            <StorageHeader />
            {children}
          </StorageProvider>
        </main>
      </div>
    </div>
  );
}
