'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { AGED_DAYS, useStorage } from '../hooks/StorageContext';
import { workerLabel } from '../../shipment-v2/hooks/useWorkers';
import { daysSince } from '../utils/storageFormat';

// ============================================================
// StorageHeader — 제목 · 탭 · 담당자 · 사용자 · 요약 카드
//
//   요약 카드: [작업중 n건 · 미배치 n개] [재고 n위치 · n개] [30일 이상 n]
//   위치 수는 "상품이 들어 있는 칸" 수가 아니라 서로 다른 위치 코드 수
// ============================================================

const TABS = [
  { href: '/storage/pending', key: 'storage.tabs.pending' },
  { href: '/storage/stock', key: 'storage.tabs.stock' },
] as const;

const StorageHeader: React.FC = () => {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { ftUsers, userId, setUserId, workers, worker, setWorker, pending, stock, reloadAll } = useStorage();

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
    };
  }, [pending.rows, stock.rows]);

  const loading = pending.loading || stock.loading;

  return (
    <header className="storage-header">
      {/* ── 1줄: 제목 + 탭 / 담당자 · 사용자 ── */}
      <div className="storage-header-top">
        <div className="storage-header-title">
          <h1>{t('storage.title')}</h1>
          <nav className="storage-tabs">
            {TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`storage-tab ${pathname?.startsWith(tab.href) ? 'is-active' : ''}`}
              >
                {t(tab.key)}
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
          <select
            className="storage-select storage-select--user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">{t('storage.selectUser')}</option>
            {ftUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.user_code} {u.vender_name || u.full_name}
              </option>
            ))}
          </select>
          <button type="button" className="storage-btn" onClick={reloadAll} disabled={!userId || loading}>
            {loading ? t('storage.loading') : t('storage.refresh')}
          </button>
        </div>
      </div>

      {/* ── 2줄: 요약 카드 ── */}
      {userId && (
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
        </div>
      )}
    </header>
  );
};

export default StorageHeader;
