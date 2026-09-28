'use client';

import React, { useEffect, useState } from 'react';
import TopsideMenu from '../../../component/TopsideMenu';
import LeftsideMenu from '../../../component/LeftsideMenu';
import ThroughputTab from './components/ThroughputTab';
import ProcessSpeedTab from './components/ProcessSpeedTab';
import './VolumeManage.css';

// ============================================================
// 물량관리 — 탭 셸
//   [물량처리] components/ThroughputTab   — 주간/월간 출고·입고·근무시간 대비 처리량
//   [처리속도] components/ProcessSpeedTab — 배송·입고·포장·출고 단계별 평균 소요일
//
//   탭은 ?tab=speed 로 딥링크 가능. useSearchParams 는 Suspense 경계가 필요하므로
//   마운트 후 window.location 에서 읽고, 전환 시 history.replaceState 로만 반영한다.
// ============================================================

type Tab = 'throughput' | 'speed';

const TAB_LABEL: Record<Tab, string> = {
  throughput: '물량처리',
  speed: '처리속도',
};

const TAB_QUERY_VALUE = 'speed';

const VolumeManage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('throughput');

  // ── 딥링크: ?tab=speed ──
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (q === TAB_QUERY_VALUE) setTab('speed');
  }, []);

  const changeTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'speed') url.searchParams.set('tab', TAB_QUERY_VALUE);
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="vm-main">
          {/* ── 페이지 헤더 + 탭 ── */}
          <div className="vm-page-header">
            <h1 className="vm-page-title">물량관리</h1>
            <div className="vm-tabs" role="tablist">
              {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`vm-tab ${tab === t ? 'active' : ''}`}
                  onClick={() => changeTab(t)}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {tab === 'throughput' ? <ThroughputTab /> : <ProcessSpeedTab />}
        </main>
      </div>
    </div>
  );
};

export default VolumeManage;
