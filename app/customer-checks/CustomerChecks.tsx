'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useWorkers } from '../import-product-v2/hooks/useWorkers';
import { CHECK_TABS, type CheckTab, type CustomerCheckListRow } from '../../lib/customerChecks';
import { useCustomerChecks, type CheckFilter } from './hooks/useCustomerChecks';
import { DecisionBadge, SizeBadge, StatusBadge, TeamBadge } from './components/CheckBadges';
import CheckDetailPanel from './components/CheckDetailPanel';
import { chinaOptions, fmtAgo, itemTitle, proxiedImage } from './utils/format';
import './CustomerChecks.css';

// ============================================================
// 고객 검수 확인 — 창고 관리 화면 (/customer-checks)
//
//   입고 [고객확인] 모달이 만든 확인요청(ft_customer_checks)을 단계별로 보고 처리한다.
//   Notion 상품확인 DB 대체. 고객 답변은 purchase-agent /inspections.
//
//   흐름: 답변 필요(확인요청) → 고객 [출고]/[취소] → 답변완료 → 창고 [처리완료]
//                           └ 고객 [재문의] → 재문의 → 창고 댓글 답변 → 고객 [출고]/[취소] 확정 → 답변완료
//                                                    └ 또는 창고가 답을 이해하고 [처리완료]
//
//   화면
//     · 상태 타일 4개 = 탭 (색 = 단계 — 배지·카드·상세 패널 모두 같은 색)
//     · 팀 칩 (ft_users display_order) — 현재 탭의 팀별 건수
//     · 카드 그리드 (상품 사진 중심) — 클릭 → 오른쪽 상세 패널 (components/CheckDetailPanel)
//   검색 = 주문번호·아이템번호·상품명 부분 일치 (Enter). 서버 페이지네이션 50건.
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

/** 상태 타일 색 (CSS 클래스) — CheckBadges.STATUS_TONE 과 같은 색 */
const TAB_TONE: Record<CheckTab, string> = {
  open: 'tone-amber',
  reinquiry: 'tone-violet',
  answered: 'tone-emerald',
  done: 'tone-zinc',
};

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

  const selectTab = useCallback((tab: CheckTab) => {
    setFilter((prev) => ({ ...prev, tab, page: 1 }));
  }, []);

  const selectTeam = useCallback((userId: string | null) => {
    setFilter((prev) => ({ ...prev, userId, page: 1 }));
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

  // ── 카드 보조 표시: 재문의에서 다음 차례가 누구인지 ──
  const turnLabel = (r: CustomerCheckListRow): { text: string; tone: string } | null => {
    if (r.status !== '재문의') return null;
    return r.last_comment_role === 'customer'
      ? { text: t('customerChecks.card.needsReply'), tone: 'is-hot' }
      : { text: t('customerChecks.card.waitingCustomer'), tone: 'is-wait' };
  };

  const tabCount = counts[filter.tab];

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="cc-main">
          <div className="cc-scroll">
            {/* ============================================================
                헤더 — 제목 + 검색
                ============================================================ */}
            <header className="cc-header">
              <div className="cc-heading">
                <h1 className="cc-title">{t('customerChecks.title')}</h1>
                <p className="cc-subtitle">{t('customerChecks.subtitle')}</p>
              </div>
              <div className="cc-header-tools">
                <label className="cc-search">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="text"
                    value={qInput}
                    placeholder={t('customerChecks.searchPlaceholder')}
                    aria-label={t('customerChecks.search')}
                    onChange={(e) => setQInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
                  />
                  {filter.q && (
                    <button type="button" className="cc-search-clear" onClick={clearSearch} aria-label={t('customerChecks.clearSearch')}>×</button>
                  )}
                </label>
                <button type="button" className="cc-icon-btn" onClick={refetch} disabled={isLoading} aria-label={t('customerChecks.refresh')} title={t('customerChecks.refresh')}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" />
                  </svg>
                </button>
              </div>
            </header>

            {/* ============================================================
                상태 타일 = 탭
                ============================================================ */}
            <nav className="cc-tiles" aria-label={t('customerChecks.tabsLabel')}>
              {CHECK_TABS.map((tab) => {
                const active = filter.tab === tab;
                const n = counts[tab].total;
                const flag = tab === 'reinquiry' || tab === 'answered' ? t(`customerChecks.tabFlag.${tab}`) : null;
                return (
                  <button
                    key={tab}
                    type="button"
                    className={`cc-tile ${TAB_TONE[tab]} ${active ? 'is-active' : ''}`}
                    onClick={() => selectTab(tab)}
                    aria-pressed={active}
                  >
                    <span className="cc-tile-head">
                      <span className="cc-tile-dot" aria-hidden="true" />
                      {t(`customerChecks.tab.${tab}`)}
                      {flag && n > 0 && <span className="cc-tile-flag">{flag}</span>}
                    </span>
                    <span className="cc-tile-count">{n}</span>
                    <span className="cc-tile-hint">{t(`customerChecks.tabHint.${tab}`)}</span>
                  </button>
                );
              })}
            </nav>

            {/* ============================================================
                팀 칩
                ============================================================ */}
            <div className="cc-teams">
              <span className="cc-teams-label">{t('customerChecks.team')}</span>
              <button
                type="button"
                className={`cc-chip ${filter.userId === null ? 'is-active' : ''}`}
                onClick={() => selectTeam(null)}
                aria-pressed={filter.userId === null}
              >
                {t('customerChecks.allTeams')} <span className="cc-chip-n">{tabCount.total}</span>
              </button>
              {users.map((u) => {
                const n = tabCount.byUser[u.id] ?? 0;
                const active = filter.userId === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`cc-chip ${active ? 'is-active' : ''} ${n === 0 ? 'is-empty' : ''}`}
                    onClick={() => selectTeam(u.id)}
                    title={u.vender_name || u.full_name || ''}
                    aria-pressed={active}
                  >
                    {u.user_code} <span className="cc-chip-n">{n}</span>
                  </button>
                );
              })}
            </div>

            {/* ============================================================
                카드 그리드
                ============================================================ */}
            {error && <div className="cc-state is-error">{error}</div>}

            {!error && !isLoading && rows.length === 0 && (
              <div className="cc-state">
                <div className="cc-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                {filter.q ? t('customerChecks.emptySearch', { q: filter.q }) : t(`customerChecks.empty.${filter.tab}`)}
              </div>
            )}

            {isLoading && rows.length === 0 && !error && (
              <div className="cc-state">{t('customerChecks.loading')}</div>
            )}

            {rows.length > 0 && (
              <ul className={`cc-grid ${isLoading ? 'is-loading' : ''}`}>
                {rows.map((r) => {
                  const img = proxiedImage(r.img_url);
                  const turn = turnLabel(r);
                  const sub = chinaOptions(r.china_option1, r.china_option2);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`cc-card ${selectedId === r.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedId(r.id)}
                      >
                        <span className="cc-card-img">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" loading="lazy" />
                          ) : (
                            <span className="cc-card-noimg">{t('customerChecks.noImage')}</span>
                          )}
                          {r.image_count > 0 && <span className="cc-card-imgn">+{r.image_count}</span>}
                        </span>
                        <span className="cc-card-body">
                          <span className="cc-card-top">
                            <TeamBadge code={r.team_code} />
                            <StatusBadge status={r.status} />
                            <DecisionBadge decision={r.status === '확인요청' ? null : r.decision} />
                            <span className="cc-card-ago">{fmtAgo(r.created_at, t)}</span>
                          </span>
                          <span className="cc-card-name">{itemTitle(r.item_name, r.option_name) || t('customerChecks.detail.noName')}</span>
                          <span className="cc-card-meta">
                            <span className="cc-mono">{r.item_no || '–'}</span>
                            {sub && <span className="cc-card-sub">{sub}</span>}
                          </span>
                          <span className="cc-card-meta">
                            <span>{t('customerChecks.card.confirm')} <b className="cc-accent">{r.confirm_qty ?? '–'}</b></span>
                            <span>{t('customerChecks.card.arrival')} <b>{r.arrival_qty ?? 0}</b></span>
                            <SizeBadge code={r.size_code} />
                            {r.comment_count > 0 && (
                              <span className="cc-card-cm">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                {r.comment_count}
                              </span>
                            )}
                          </span>
                          {(r.attributes.length > 0 || turn) && (
                            <span className="cc-card-foot">
                              {r.attributes.map((a, i) => <span key={`${a}-${i}`} className="cc-attr">{a}</span>)}
                              {turn && <span className={`cc-turn ${turn.tone}`}>{turn.text}</span>}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 페이지네이션 */}
            {total > pageSize && (
              <div className="cc-pager">
                <button type="button" className="cc-icon-btn" disabled={filter.page <= 1 || isLoading}
                  onClick={() => setFilter((p) => ({ ...p, page: p.page - 1 }))} aria-label={t('customerChecks.prevPage')}>‹</button>
                <span className="cc-pager-label">
                  {t('customerChecks.pager', { page: filter.page, pages: totalPages, total })}
                </span>
                <button type="button" className="cc-icon-btn" disabled={filter.page >= totalPages || isLoading}
                  onClick={() => setFilter((p) => ({ ...p, page: p.page + 1 }))} aria-label={t('customerChecks.nextPage')}>›</button>
              </div>
            )}
            {total > 0 && total <= pageSize && (
              <div className="cc-total">{t('customerChecks.total', { total })}</div>
            )}
          </div>

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
