'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useWorkers } from '../import-product-v2/hooks/useWorkers';
import type { CheckTab, CustomerCheckListRow } from '../../lib/customerChecks';
import { useCustomerChecks, type CheckFilter } from './hooks/useCustomerChecks';
import { DecisionBadge, SizeBadge, StatusBadge, TeamBadge } from './components/CheckBadges';
import CheckDetailPanel from './components/CheckDetailPanel';
import { chinaOptions, fmtDateShort, itemTitle } from './utils/format';
import './CustomerChecks.css';

// ============================================================
// 고객 검수 확인 — 창고 관리 화면 (/customer-checks)
//
//   입고 [고객확인] 모달이 만든 확인요청(ft_customer_checks)을 팀별로 보고,
//   고객(purchase-agent /inspections)의 답변을 확인해 처리한다. Notion 상품확인 DB 대체.
//
//   상단 탭
//     · 전체 / 팀별(ft_users display_order 순) — 고객 답을 기다리는 건(확인요청·재확인요청), 배지 = 건수
//     · 답변완료 — 고객이 답한 건, 창고가 처리할 차례
//     · 처리완료
//   검색 = 주문번호·아이템번호·상품명 부분 일치 (Enter). 목록은 서버 페이지네이션 50건.
//   행 클릭 → 오른쪽 슬라이드 패널 (components/CheckDetailPanel)
// ============================================================

/** /api/ft/users 응답 중 쓰는 컬럼 */
interface FtUserOption {
  id: string;
  user_code: string | null;
  vender_name: string | null;
  full_name: string | null;
}

/** 댓글 작성자(Worker) 기억 — 이 PC 브라우저 */
const AUTHOR_STORAGE_KEY = 'customer_checks_author_v1';

const CustomerChecks: React.FC = () => {
  const { t } = useTranslation();
  const workers = useWorkers();

  // ── 팀(사업자) 목록 ──
  const [users, setUsers] = useState<FtUserOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/ft/users', { cache: 'no-store' });
        const json = await res.json();
        if (json.success) setUsers((json.data as FtUserOption[]).filter((u) => u.user_code));
      } catch (e) {
        console.error('ft_users 조회 오류:', e);
      }
    })();
  }, []);

  // ── 필터 ──
  const [filter, setFilter] = useState<CheckFilter>({ tab: 'open', userId: null, q: '', page: 1 });
  const [qInput, setQInput] = useState('');
  const { rows, total, pageSize, counts, isLoading, error, refetch } = useCustomerChecks(filter);

  const selectTab = useCallback((tab: CheckTab, userId: string | null = null) => {
    setFilter((prev) => ({ ...prev, tab, userId, page: 1 }));
  }, []);

  const applySearch = useCallback(() => {
    setFilter((prev) => ({ ...prev, q: qInput.trim(), page: 1 }));
  }, [qInput]);

  const clearSearch = useCallback(() => {
    setQInput('');
    setFilter((prev) => ({ ...prev, q: '', page: 1 }));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 처리 중 건수가 줄어 현재 페이지가 비면 마지막 페이지로
  useEffect(() => {
    if (!isLoading && rows.length === 0 && filter.page > 1 && total > 0) {
      setFilter((prev) => ({ ...prev, page: Math.max(1, Math.ceil(total / pageSize)) }));
    }
  }, [isLoading, rows.length, filter.page, total, pageSize]);
  const openTotal = useMemo(
    () => Object.values(counts.openByUser).reduce((s, n) => s + n, 0),
    [counts.openByUser]
  );

  // ── 상세 패널 ──
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── 댓글 작성자 ──
  const [authorName, setAuthorName] = useState('');
  useEffect(() => {
    try {
      setAuthorName(window.localStorage.getItem(AUTHOR_STORAGE_KEY) ?? '');
    } catch { /* 저장소 사용 불가 — 빈 값 유지 */ }
  }, []);
  const changeAuthor = useCallback((name: string) => {
    setAuthorName(name);
    try { window.localStorage.setItem(AUTHOR_STORAGE_KEY, name); } catch { /* 무시 */ }
  }, []);

  // ── 렌더 ──
  const isOpenTab = filter.tab === 'open';

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="cc-main">
          {/* ============================================================
              헤더 — 제목 + 탭 + 검색
              ============================================================ */}
          <header className="cc-header">
            <div className="cc-title-row">
              <h1 className="cc-title">{t('customerChecks.title')}</h1>
              <span className="cc-title-sub">{t('customerChecks.subtitle')}</span>
              <button type="button" className="cc-refresh" onClick={refetch} disabled={isLoading} title={t('customerChecks.refresh')}>
                ⟳
              </button>
            </div>

            <div className="cc-toolbar">
              <nav className="cc-tabs" aria-label="tabs">
                <button
                  type="button"
                  className={`cc-tab ${isOpenTab && filter.userId === null ? 'is-active' : ''}`}
                  onClick={() => selectTab('open', null)}
                >
                  {t('customerChecks.tab.allTeams')}
                  <span className={`cc-tab-count ${openTotal > 0 ? 'is-hot' : ''}`}>{openTotal}</span>
                </button>
                {users.map((u) => {
                  const n = counts.openByUser[u.id] ?? 0;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={`cc-tab ${isOpenTab && filter.userId === u.id ? 'is-active' : ''}`}
                      onClick={() => selectTab('open', u.id)}
                      title={u.vender_name || u.full_name || ''}
                    >
                      {u.user_code}
                      <span className={`cc-tab-count ${n > 0 ? 'is-hot' : ''}`}>{n}</span>
                    </button>
                  );
                })}
                <span className="cc-tab-sep" />
                <button
                  type="button"
                  className={`cc-tab cc-tab-answered ${filter.tab === 'answered' ? 'is-active' : ''}`}
                  onClick={() => selectTab('answered')}
                >
                  {t('customerChecks.tab.answered')}
                  <span className={`cc-tab-count ${counts.answered > 0 ? 'is-green' : ''}`}>{counts.answered}</span>
                </button>
                <button
                  type="button"
                  className={`cc-tab ${filter.tab === 'done' ? 'is-active' : ''}`}
                  onClick={() => selectTab('done')}
                >
                  {t('customerChecks.tab.done')}
                  <span className="cc-tab-count">{counts.done}</span>
                </button>
              </nav>

              <div className="cc-search">
                <input
                  type="text"
                  className="cc-search-input"
                  value={qInput}
                  placeholder={t('customerChecks.searchPlaceholder')}
                  onChange={(e) => setQInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
                />
                {filter.q ? (
                  <button type="button" className="cc-search-btn is-clear" onClick={clearSearch}>×</button>
                ) : (
                  <button type="button" className="cc-search-btn" onClick={applySearch}>{t('customerChecks.search')}</button>
                )}
              </div>
            </div>
          </header>

          {/* ============================================================
              목록
              ============================================================ */}
          <section className="cc-list">
            {error && <div className="cc-state is-error">{error}</div>}

            {!error && !isLoading && rows.length === 0 && (
              <div className="cc-state">
                <div className="cc-state-icon">✓</div>
                {filter.q ? t('customerChecks.emptySearch', { q: filter.q }) : t(`customerChecks.empty.${filter.tab}`)}
              </div>
            )}

            {rows.length > 0 && (
              <div className="cc-table-wrap">
                <table className={`cc-table ${isLoading ? 'is-loading' : ''}`}>
                  <thead>
                    <tr>
                      <th>{t('customerChecks.col.team')}</th>
                      <th>{t('customerChecks.col.status')}</th>
                      <th>{t('customerChecks.col.decision')}</th>
                      <th>{t('customerChecks.col.itemNo')}</th>
                      <th className="cc-th-name">{t('customerChecks.col.item')}</th>
                      <th className="cc-th-num">{t('customerChecks.col.qty')}</th>
                      <th>{t('customerChecks.col.size')}</th>
                      <th>{t('customerChecks.col.requestedBy')}</th>
                      <th>{t('customerChecks.col.createdAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: CustomerCheckListRow) => (
                      <tr
                        key={r.id}
                        className={`cc-row ${selectedId === r.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <td><TeamBadge code={r.team_code} /></td>
                        <td><StatusBadge status={r.status} /></td>
                        <td><DecisionBadge decision={r.decision} qty={r.decision_qty} /></td>
                        <td className="cc-mono">
                          <div>{r.item_no || '–'}</div>
                          {r.order_no && <div className="cc-cell-sub">{r.order_no}</div>}
                        </td>
                        <td className="cc-td-name">
                          <div className="cc-cell-name">{itemTitle(r.item_name, r.option_name) || '–'}</div>
                          <div className="cc-cell-meta">
                            {chinaOptions(r.china_option1, r.china_option2) && (
                              <span className="cc-cell-sub">{chinaOptions(r.china_option1, r.china_option2)}</span>
                            )}
                            {r.comment_count > 0 && <span className="cc-mini">💬 {r.comment_count}</span>}
                            {r.image_count > 0 && <span className="cc-mini">🖼 {r.image_count}</span>}
                            {r.attributes.length > 0 && <span className="cc-mini cc-mini-attrs">{r.attributes.join(' · ')}</span>}
                          </div>
                        </td>
                        <td className="cc-td-num cc-mono">
                          <b>{r.confirm_qty ?? '–'}</b>
                          <span className="cc-cell-sub"> / {r.arrival_qty ?? 0}</span>
                        </td>
                        <td><SizeBadge code={r.size_code} /></td>
                        <td className="cc-td-worker">{r.requested_by || '–'}</td>
                        <td className="cc-mono">{fmtDateShort(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {isLoading && rows.length === 0 && !error && (
              <div className="cc-state">{t('customerChecks.loading')}</div>
            )}

            {/* 페이지네이션 */}
            {total > pageSize && (
              <div className="cc-pager">
                <button type="button" className="cc-pager-btn" disabled={filter.page <= 1 || isLoading}
                  onClick={() => setFilter((p) => ({ ...p, page: p.page - 1 }))}>‹</button>
                <span className="cc-pager-label">
                  {t('customerChecks.pager', { page: filter.page, pages: totalPages, total })}
                </span>
                <button type="button" className="cc-pager-btn" disabled={filter.page >= totalPages || isLoading}
                  onClick={() => setFilter((p) => ({ ...p, page: p.page + 1 }))}>›</button>
              </div>
            )}
            {total > 0 && total <= pageSize && (
              <div className="cc-total">{t('customerChecks.total', { total })}</div>
            )}
          </section>

          {/* ============================================================
              상세 패널
              ============================================================ */}
          {selectedId && (
            <CheckDetailPanel
              checkId={selectedId}
              onClose={() => setSelectedId(null)}
              onChanged={refetch}
              onNavigate={setSelectedId}
              authorName={authorName}
              onAuthorChange={changeAuthor}
              workers={workers}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default CustomerChecks;
