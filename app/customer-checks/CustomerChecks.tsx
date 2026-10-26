'use client';

import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { useWorkers } from '../import-product-v2/hooks/useWorkers';
import {
  ANSWERED_DECISIONS,
  CHECK_TABS,
  CHECK_TAB_STATUS,
  type AnsweredDecision,
  type CheckTab,
  type CustomerCheckListRow,
} from '../../lib/customerChecks';
import { useCustomerChecks, type CheckFilter } from './hooks/useCustomerChecks';
import { DECISION_DOT, DecisionBadge, SizeBadge, StatusBadge, STATUS_DOT, TeamBadge } from './components/CheckBadges';
import CheckDetailPanel from './components/CheckDetailPanel';
import { chinaOptions, fmtAgo, proxiedImage } from './utils/format';
import './CustomerChecks.css';

// ============================================================
// 고객 검수 확인 — 창고 관리 화면 (/customer-checks)
//
//   입고 [고객확인] 모달이 만든 확인요청(ft_customer_checks)을 단계별로 보고 처리한다.
//   고객 답변은 purchase-agent /inspections.
//
//   흐름: 답변 필요(확인요청) → 고객 [출고]/[취소] → 답변완료 → 창고 [처리완료]
//                           └ 고객 [재문의] → 재문의 → 창고 댓글 답변 → 고객 [출고]/[취소] 확정 → 답변완료
//                                                    └ 또는 창고가 답을 이해하고 [처리완료]
//
//   화면 (미니멀 톤 — 고객 화면과 같은 규칙: 회색·검정 + 단계 색은 점 하나)
//     · 단계 타일 4개 = 탭, 사이에 › (진행 순서), 건수는 두 번째 줄에 크게
//     · 도구줄: 왼쪽 팀 칩 / 오른쪽 [출고]·[취소](답변완료 탭 — 모아 보기) + [다중선택]
//     · 다중선택: 카드를 눌러 고르고 일괄 [처리완료] (처리완료 탭에는 없음)
//     · 카드: 상품 사진 · item_name · 중국어 옵션 (중국 작업자용 — 한글 옵션명은 표시하지 않음)
//             재문의에서 마지막 댓글이 고객이면 그 내용을 카드에 바로 보여 준다
//     · 카드 클릭 → 오른쪽 상세 패널 (components/CheckDetailPanel)
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

/** 다중선택이 가능한 탭 — 일괄 [처리완료] 대상 (처리완료 탭은 대상 없음) */
const BULK_TABS: CheckTab[] = ['open', 'reinquiry', 'answered'];

/** 할 일이 남은 단계 — 건수를 진하게 */
const ACTION_TABS: CheckTab[] = ['reinquiry', 'answered'];

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
  const [filter, setFilter] = useState<CheckFilter>({ tab: 'open', userId: null, decision: null, q: '', page: 1 });
  const [qInput, setQInput] = useState('');
  const { rows, total, pageSize, counts, answeredByDecision, isLoading, error, refetch } = useCustomerChecks(filter);

  const selectTab = useCallback((tab: CheckTab) => {
    // 출고/취소 필터는 답변완료 탭 전용 — 탭을 바꾸면 해제
    setFilter((prev) => ({ ...prev, tab, decision: null, page: 1 }));
  }, []);

  const selectTeam = useCallback((userId: string | null) => {
    setFilter((prev) => ({ ...prev, userId, page: 1 }));
  }, []);

  const selectDecision = useCallback((decision: AnsweredDecision | null) => {
    setFilter((prev) => ({ ...prev, decision, page: 1 }));
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

  // ── 다중선택 ──
  //   모드는 탭을 바꿔도 유지하되(처리완료 탭으로 가면 끔), 고른 건은 화면에 보이는 행이 바뀌면 비운다.
  const [multiMode, setMultiMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const canBulk = BULK_TABS.includes(filter.tab);

  useEffect(() => {
    setPicked(new Set());
  }, [filter.tab, filter.userId, filter.decision, filter.q, filter.page]);

  useEffect(() => {
    if (!canBulk) setMultiMode(false);
  }, [canBulk]);

  // 목록이 다시 오면 사라진 행은 선택에서 뺀다 (다른 사람이 먼저 처리한 경우)
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const togglePick = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const togglePickAll = useCallback(() => {
    setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)));
  }, [allPicked, rows]);

  const exitMulti = useCallback(() => {
    setMultiMode(false);
    setPicked(new Set());
  }, []);

  const bulkClose = useCallback(async () => {
    if (bulkBusy || picked.size === 0) return;
    const msg = filter.tab === 'open'
      ? t('customerChecks.bulk.confirmWithdraw', { count: picked.size })
      : t('customerChecks.bulk.confirmClose', { count: picked.size });
    if (!window.confirm(msg)) return;

    setBulkBusy(true);
    setBulkNotice(null);
    try {
      const res = await fetch('/api/ft/customer-checks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', ids: Array.from(picked) }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('customerChecks.detail.actionError'));
      setBulkNotice({
        kind: 'ok',
        text: json.skipped > 0
          ? t('customerChecks.bulk.doneWithSkip', { closed: json.closed, skipped: json.skipped })
          : t('customerChecks.bulk.done', { closed: json.closed }),
      });
      setPicked(new Set());
      refetch();
    } catch (e) {
      console.error('customer-checks 일괄 처리완료 오류:', e);
      setBulkNotice({ kind: 'error', text: e instanceof Error ? e.message : t('customerChecks.detail.actionError') });
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, picked, filter.tab, t, refetch]);

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

  const tabCount = counts[filter.tab];
  const answeredTotal = useMemo(
    () => answeredByDecision['출고'] + answeredByDecision['취소'],
    [answeredByDecision]
  );

  // ── 카드 클릭 — 다중선택 중이면 고르기, 아니면 상세 ──
  const onCardClick = (r: CustomerCheckListRow) => {
    if (multiMode) togglePick(r.id);
    else setSelectedId(r.id);
  };

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
                단계 타일 = 탭 — 진행 순서대로, 사이에 ›
                ============================================================ */}
            <nav className="cc-steps-nav" aria-label={t('customerChecks.tabsLabel')}>
              <ol className="cc-tiles">
                {CHECK_TABS.map((tab, i) => {
                  const active = filter.tab === tab;
                  const n = counts[tab].total;
                  const strong = n > 0 && ACTION_TABS.includes(tab);
                  return (
                    <Fragment key={tab}>
                      {i > 0 && (
                        <li className="cc-tile-arrow" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
                        </li>
                      )}
                      <li className="cc-tile-cell">
                        <button
                          type="button"
                          className={`cc-tile ${active ? 'is-active' : ''}`}
                          onClick={() => selectTab(tab)}
                          aria-pressed={active}
                        >
                          <span className="cc-tile-head">
                            <span className={`cc-dot ${STATUS_DOT[CHECK_TAB_STATUS[tab]]}`} aria-hidden="true" />
                            {t(`customerChecks.tab.${tab}`)}
                            <span className="cc-tile-step">{t('customerChecks.step', { n: i + 1 })}</span>
                          </span>
                          <span className={`cc-tile-count ${strong ? 'is-strong' : n === 0 ? 'is-zero' : ''}`}>{n}</span>
                          <span className="cc-tile-hint">{t(`customerChecks.tabHint.${tab}`)}</span>
                        </button>
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            </nav>

            {/* ============================================================
                도구줄 — 왼쪽 팀 칩 / 오른쪽 출고·취소(답변완료) + 다중선택
                ============================================================ */}
            <div className="cc-toolbar">
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

              <div className="cc-toolbar-right">
                {/* 답변완료 — 출고분 / 취소분 모아 보기 */}
                {filter.tab === 'answered' && (
                  <div className="cc-seg" role="group" aria-label={t('customerChecks.decisionFilter')}>
                    <button
                      type="button"
                      className={`cc-seg-btn ${filter.decision === null ? 'is-active' : ''}`}
                      onClick={() => selectDecision(null)}
                      aria-pressed={filter.decision === null}
                    >
                      {t('customerChecks.allTeams')} <span className="cc-chip-n">{answeredTotal}</span>
                    </button>
                    {ANSWERED_DECISIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`cc-seg-btn ${filter.decision === d ? 'is-active' : ''}`}
                        onClick={() => selectDecision(d)}
                        aria-pressed={filter.decision === d}
                      >
                        <span className={`cc-dot ${DECISION_DOT[d]}`} aria-hidden="true" />
                        {t(`customerChecks.decision.${d}`)} <span className="cc-chip-n">{answeredByDecision[d]}</span>
                      </button>
                    ))}
                  </div>
                )}

                {canBulk && (
                  <button
                    type="button"
                    className={`cc-btn ${multiMode ? 'cc-btn-dark' : 'cc-btn-ghost'}`}
                    onClick={() => (multiMode ? exitMulti() : setMultiMode(true))}
                    aria-pressed={multiMode}
                  >
                    {t('customerChecks.bulk.toggle')}
                  </button>
                )}
              </div>
            </div>

            {/* ── 다중선택 막대 ── */}
            {multiMode && canBulk && (
              <div className="cc-bulkbar" role="region" aria-label={t('customerChecks.bulk.toggle')}>
                <label className="cc-bulk-all">
                  <input type="checkbox" checked={allPicked} onChange={togglePickAll} disabled={rows.length === 0 || bulkBusy} />
                  {t('customerChecks.bulk.pickPage')}
                </label>
                <span className="cc-bulk-count">{t('customerChecks.bulk.picked', { count: picked.size })}</span>
                <div className="cc-bulk-actions">
                  <button type="button" className="cc-btn cc-btn-ghost" onClick={exitMulti} disabled={bulkBusy}>
                    {t('customerChecks.bulk.cancel')}
                  </button>
                  <button type="button" className="cc-btn cc-btn-dark" onClick={bulkClose} disabled={bulkBusy || picked.size === 0}>
                    {bulkBusy ? t('customerChecks.saving') : t('customerChecks.bulk.close', { count: picked.size })}
                  </button>
                </div>
              </div>
            )}
            {bulkNotice && (
              <div className={`cc-notice is-${bulkNotice.kind}`} role="status">{bulkNotice.text}</div>
            )}

            {/* ============================================================
                카드 그리드
                ============================================================ */}
            {error && <div className="cc-state is-error">{error}</div>}

            {!error && !isLoading && rows.length === 0 && (
              <div className="cc-state">
                <div className="cc-state-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                {filter.q
                  ? t('customerChecks.emptySearch', { q: filter.q })
                  : filter.tab === 'answered' && filter.decision
                    ? t('customerChecks.emptyDecision', { decision: t(`customerChecks.decision.${filter.decision}`) })
                    : t(`customerChecks.empty.${filter.tab}`)}
              </div>
            )}

            {isLoading && rows.length === 0 && !error && (
              <div className="cc-state">{t('customerChecks.loading')}</div>
            )}

            {rows.length > 0 && (
              <ul className={`cc-grid ${isLoading ? 'is-loading' : ''}`}>
                {rows.map((r) => {
                  const img = proxiedImage(r.img_url);
                  const sub = chinaOptions(r.china_option1, r.china_option2);
                  const isPicked = picked.has(r.id);
                  // 재문의 — 마지막 댓글이 고객이면 창고가 답할 차례: 고객이 남긴 말을 카드에 보여 준다
                  const customerAsks = r.status === '재문의' && r.last_comment_role === 'customer' && r.last_comment_body;
                  const waitingCustomer = r.status === '재문의' && r.last_comment_role !== 'customer';
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`cc-card ${selectedId === r.id && !multiMode ? 'is-selected' : ''} ${isPicked ? 'is-picked' : ''}`}
                        onClick={() => onCardClick(r)}
                        aria-pressed={multiMode ? isPicked : undefined}
                      >
                        <span className="cc-card-img">
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" loading="lazy" />
                          ) : (
                            <span className="cc-card-noimg">{t('customerChecks.noImage')}</span>
                          )}
                          {r.image_count > 0 && <span className="cc-card-imgn">+{r.image_count}</span>}
                          {multiMode && (
                            <span className={`cc-card-check ${isPicked ? 'is-on' : ''}`} aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
                            </span>
                          )}
                        </span>
                        <span className="cc-card-body">
                          <span className="cc-card-top">
                            <TeamBadge code={r.team_code} />
                            <SizeBadge code={r.size_code} />
                            <StatusBadge status={r.status} />
                            {r.status !== '확인요청' && r.status !== '재문의' && <DecisionBadge decision={r.decision} />}
                            <span className="cc-card-ago">{fmtAgo(r.created_at, t)}</span>
                          </span>
                          <span className="cc-card-name">{r.item_name || t('customerChecks.detail.noName')}</span>
                          {sub && <span className="cc-card-option">{sub}</span>}
                          <span className="cc-card-meta">
                            <span className="cc-mono">{r.item_no || '–'}</span>
                            <span>{t('customerChecks.card.confirm')} <b>{r.confirm_qty ?? '–'}</b></span>
                            <span>{t('customerChecks.card.arrival')} <b>{r.arrival_qty ?? 0}</b></span>
                            {r.comment_count > 0 && (
                              <span className="cc-card-cm">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                {r.comment_count}
                              </span>
                            )}
                          </span>
                          {r.attributes.length > 0 && (
                            <span className="cc-card-foot">
                              {r.attributes.map((a, i) => <span key={`${a}-${i}`} className="cc-attr">{a}</span>)}
                            </span>
                          )}
                          {customerAsks && (
                            <span className="cc-card-ask">
                              <span className="cc-card-ask-label">
                                <span className="cc-dot dot-violet" aria-hidden="true" />
                                {t('customerChecks.card.customerAsked')}
                              </span>
                              <span className="cc-card-ask-body">{r.last_comment_body}</span>
                            </span>
                          )}
                          {waitingCustomer && (
                            <span className="cc-card-wait">{t('customerChecks.card.waitingCustomer')}</span>
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
