'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AGED_DAYS, useStorage } from '../hooks/StorageContext';
import { workerLabel } from '../../shipment-v2/hooks/useWorkers';
import { daysSince } from '../utils/storageFormat';

// ============================================================
// StorageHeader — 제목 · 화면 탭 · 담당자 · 사업자 탭(전체 + 사업자별) · 요약 카드
//
//   요약 카드: [작업중 n건 · 미배치 n개] [재고 n위치 · n개] [30일 이상 n]
//   위치 수는 "상품이 들어 있는 칸" 수가 아니라 서로 다른 위치 코드 수
// ============================================================

const TABS = [
  { href: '/storage/pending', key: 'storage.tabs.pending' },
  { href: '/storage/stock', key: 'storage.tabs.stock' },
  { href: '/storage/wow', key: 'storage.tabs.wow' },
] as const;

const StorageHeader: React.FC = () => {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { ftUsers, tab, setTab, workers, worker, setWorker, pending, stock, wow, requests, reloadAll } = useStorage();

  // ── 요약 수치 ──
  const summary = useMemo(() => {
    const unplaced = pending.rows.reduce((s, r) => s + r.line_unplaced, 0);
    const positive = stock.rows.filter((r) => r.qty > 0);
    const now = new Date();
    return {
      lines: pending.rows.length,
      unplaced,
      locations: new Set(positive.map((r) => r.location_id)).size,
      stockQty: positive.reduce((s, r) => s + r.qty, 0),
      aged: positive.filter((r) => (daysSince(r.first_putaway_at, now) ?? 0) >= AGED_DAYS).length,
      requested: requests.filter((q) => q.status === 'REQUESTED').length,
    };
  }, [pending.rows, stock.rows, requests]);

  const loading = pending.loading || stock.loading || wow.loading;
  const userTabs = [{ id: '', label: t('storage.tabs.all'), title: '' },
    ...ftUsers.map((u) => ({ id: u.id, label: u.user_code, title: u.vender_name || u.full_name }))];

  return (
    <header className="storage-header">
      {/* ── 1줄: 제목 + 화면 탭 / 담당자 · 새로고침 ── */}
      <div className="storage-header-top">
        <div className="storage-header-title">
          <h1>{t('storage.title')}</h1>
          <nav className="storage-tabs">
            {TABS.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className={`storage-tab ${pathname?.startsWith(page.href) ? 'is-active' : ''}`}
              >
                {t(page.key)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="storage-header-controls">
          <select
            className={`storage-select ${worker ? '' : 'is-empty'}`}
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          >
            <option value="">{t('storage.selectWorker')}</option>
            {workers.map((w) => (
              <option key={w.id} value={workerLabel(w)}>{workerLabel(w)}</option>
            ))}
          </select>
          <button type="button" className="storage-btn" onClick={reloadAll} disabled={loading}>
            {loading ? t('storage.loading') : t('storage.refresh')}
          </button>
        </div>
      </div>

      {/* ── 2줄: 사업자 탭 ── */}
      <nav className="storage-tabs storage-user-tabs">
        {userTabs.map((u) => (
          <button
            key={u.id || 'all'}
            type="button"
            className={`storage-tab ${tab === u.id ? 'is-active' : ''}`}
            title={u.title}
            onClick={() => setTab(u.id)}
          >
            {u.label}
          </button>
        ))}
      </nav>

      {/* ── 3줄: 요약 카드 ── */}
      <div className="storage-cards">
        <div className="storage-card">
          <span className="storage-card-label">{t('storage.tabs.pending')}</span>
          <strong>{t('storage.summary.pending', { lines: summary.lines, qty: summary.unplaced })}</strong>
        </div>
        <div className="storage-card">
          <span className="storage-card-label">{t('storage.tabs.stock')}</span>
          <strong>{t('storage.summary.stock', { locations: summary.locations, qty: summary.stockQty })}</strong>
        </div>
        <div className={`storage-card ${summary.aged > 0 ? 'is-warn' : ''}`}>
          <span className="storage-card-label">{t('storage.summary.agedLabel', { days: AGED_DAYS })}</span>
          <strong>{summary.aged}</strong>
        </div>
        <div className={`storage-card ${summary.requested > 0 ? 'is-request' : ''}`}>
          <span className="storage-card-label">{t('storage.request.label')}</span>
          <strong>{t('storage.summary.requests', { count: summary.requested })}</strong>
        </div>
      </div>
    </header>
  );
};

export default StorageHeader;
