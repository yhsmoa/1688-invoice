'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHECK_TRANSITIONS,
  type CheckAction,
  type CustomerCheckDetail,
} from '../../../lib/customerChecks';
import type { Worker } from '../../import-product-v2/hooks/useWorkers';
import { DecisionBadge, SizeBadge, StatusBadge, TeamBadge } from './CheckBadges';
import CheckImageViewer from './CheckImageViewer';
import { chinaOptions, fmtDateTime, itemTitle, proxiedImage } from '../utils/format';

// ============================================================
// 고객 검수 확인 — 상세 슬라이드 패널
//
//   GET /api/ft/customer-checks/[id] 로 건·댓글·이미지·관련 요청을 가져온다.
//   하단 작성칸 하나로 댓글 추가 / 재확인요청(댓글 필수) / 처리완료 / 다시 열기를 처리:
//     · [댓글]        POST  …/comments
//     · [재확인요청]  PATCH action=recheck  (작성칸 내용이 댓글 — 비어 있으면 안내)
//     · [처리완료]    PATCH action=close    (작성칸 내용이 있으면 함께 댓글로)
//     · [다시 열기]   PATCH action=reopen   (〃)
//   버튼은 현재 상태에서 가능한 전이(lib/customerChecks.CHECK_TRANSITIONS)만 보인다.
//   서버가 409 를 주면(다른 사람이 먼저 바꿈) 안내 후 다시 불러온다.
// ============================================================

interface Props {
  checkId: string;
  onClose: () => void;
  /** 상태·댓글이 바뀐 뒤 목록 갱신 */
  onChanged: () => void;
  /** 관련 요청 클릭 → 그 건으로 이동 */
  onNavigate: (id: string) => void;
  /** 댓글 작성자 (Worker 이름) — 페이지가 기억·전달 */
  authorName: string;
  onAuthorChange: (name: string) => void;
  workers: Worker[];
}

type DetailState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: CustomerCheckDetail };

const CheckDetailPanel: React.FC<Props> = ({
  checkId, onClose, onChanged, onNavigate, authorName, onAuthorChange, workers,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<DetailState>({ phase: 'loading' });
  const [composer, setComposer] = useState('');
  const [busy, setBusy] = useState<CheckAction | 'comment' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const seqRef = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);

  // ── 상세 조회 ──
  const load = useCallback(async (silent = false) => {
    const seq = ++seqRef.current;
    if (!silent) setState({ phase: 'loading' });
    try {
      const res = await fetch(`/api/ft/customer-checks/${checkId}`, { cache: 'no-store' });
      const json = await res.json();
      if (seq !== seqRef.current) return;
      if (!res.ok || !json.success) throw new Error(json.error || t('customerChecks.detail.loadError'));
      setState({ phase: 'ready', data: json as CustomerCheckDetail });
    } catch (e) {
      if (seq !== seqRef.current) return;
      console.error('customer-check 상세 조회 오류:', e);
      setState({ phase: 'error', message: e instanceof Error ? e.message : t('customerChecks.detail.loadError') });
    }
  }, [checkId, t]);

  useEffect(() => {
    setComposer('');
    setNotice(null);
    setViewer(null);
    load();
  }, [load]);

  // 댓글이 늘면 스레드 끝으로
  const commentCount = state.phase === 'ready' ? state.data.comments.length : 0;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [commentCount]);

  // ── Esc 닫기 (이미지 뷰어가 열려 있으면 뷰어가 먼저 닫힌다) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewer === null && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewer, busy]);

  // ── 이미지 목록 (상품 원본 → 첨부) ──
  const imageUrls = useMemo(() => {
    if (state.phase !== 'ready') return [] as { url: string; label: string }[];
    const list: { url: string; label: string }[] = [];
    const product = proxiedImage(state.data.check.img_url);
    if (product) list.push({ url: product, label: t('customerChecks.detail.productImage') });
    state.data.images.forEach((img, i) => list.push({ url: img.public_url, label: `${t('customerChecks.detail.attached')} ${i + 1}` }));
    return list;
  }, [state, t]);

  // ── 전이 / 댓글 ──
  const runAction = useCallback(async (action: CheckAction) => {
    if (busy) return;
    const body = composer.trim();
    const rule = CHECK_TRANSITIONS[action];
    if (rule.commentRequired && !body) {
      setNotice({ kind: 'error', text: t('customerChecks.detail.recheckNeedsComment') });
      return;
    }
    if (action === 'close' && !window.confirm(t('customerChecks.detail.confirmClose'))) return;

    setBusy(action);
    setNotice(null);
    try {
      const res = await fetch(`/api/ft/customer-checks/${checkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: body || null, author_name: authorName || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('customerChecks.detail.actionError'));
      setComposer('');
      setNotice({ kind: 'ok', text: t(`customerChecks.detail.done.${action}`) });
      await load(true);
      onChanged();
    } catch (e) {
      console.error('customer-check 전이 오류:', e);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : t('customerChecks.detail.actionError') });
      await load(true);   // 409 등 — 최신 상태로 갱신
    } finally {
      setBusy(null);
    }
  }, [busy, composer, checkId, authorName, t, load, onChanged]);

  const submitComment = useCallback(async () => {
    if (busy) return;
    const body = composer.trim();
    if (!body) {
      setNotice({ kind: 'error', text: t('customerChecks.detail.commentEmpty') });
      return;
    }
    setBusy('comment');
    setNotice(null);
    try {
      const res = await fetch(`/api/ft/customer-checks/${checkId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, author_name: authorName || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('customerChecks.detail.actionError'));
      setComposer('');
      await load(true);
      onChanged();
    } catch (e) {
      console.error('customer-check 댓글 오류:', e);
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : t('customerChecks.detail.actionError') });
    } finally {
      setBusy(null);
    }
  }, [busy, composer, checkId, authorName, t, load, onChanged]);

  // Ctrl/Cmd + Enter → 댓글
  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  };

  // ── 렌더 ──
  const data = state.phase === 'ready' ? state.data : null;
  const check = data?.check ?? null;
  const availableActions = check
    ? (Object.keys(CHECK_TRANSITIONS) as CheckAction[]).filter((a) => CHECK_TRANSITIONS[a].from.includes(check.status))
    : [];

  return (
    <div className="cc-overlay" onClick={() => { if (!busy) onClose(); }}>
      <aside className="cc-panel" onClick={(e) => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <header className="cc-panel-header">
          <div className="cc-panel-head-left">
            {check && <TeamBadge code={check.team_code} />}
            <h2 className="cc-panel-title">{check?.item_no || t('customerChecks.detail.noItemNo')}</h2>
            {check && <StatusBadge status={check.status} />}
          </div>
          <button type="button" className="cc-panel-close" onClick={onClose} disabled={!!busy} aria-label="close">×</button>
        </header>

        {/* ── 바디 ── */}
        <div className="cc-panel-body">
          {state.phase === 'loading' && <div className="cc-panel-state">{t('customerChecks.loading')}</div>}
          {state.phase === 'error' && (
            <div className="cc-panel-state is-error">
              {state.message}
              <button type="button" className="cc-btn-ghost" onClick={() => load()}>{t('customerChecks.retry')}</button>
            </div>
          )}

          {data && check && (
            <>
              {/* 상품명 · 옵션 */}
              <section className="cc-sec">
                <div className="cc-item-title">{itemTitle(check.item_name, check.option_name) || t('customerChecks.detail.noName')}</div>
                {chinaOptions(check.china_option1, check.china_option2) && (
                  <div className="cc-item-sub">{chinaOptions(check.china_option1, check.china_option2)}</div>
                )}
              </section>

              {/* 이미지 띠 */}
              {imageUrls.length > 0 && (
                <section className="cc-sec">
                  <div className="cc-img-strip">
                    {imageUrls.map((img, i) => (
                      <button
                        key={`${img.url}-${i}`}
                        type="button"
                        className={`cc-img-tile ${i === 0 && check.img_url ? 'is-product' : ''}`}
                        onClick={() => setViewer(i)}
                        title={img.label}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={img.label} loading="lazy" />
                        <span className="cc-img-label">{img.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* 고객 선택 */}
              {check.decision && (
                <section className="cc-sec cc-decision-box">
                  <div className="cc-sec-title">{t('customerChecks.detail.customerDecision')}</div>
                  <div className="cc-decision-row">
                    <DecisionBadge decision={check.decision} qty={check.decision_qty} />
                    <span className="cc-muted">{fmtDateTime(check.answered_at)}</span>
                  </div>
                </section>
              )}

              {/* 확인 항목 */}
              <section className="cc-sec">
                <div className="cc-sec-title">{t('customerChecks.detail.attributes')}</div>
                {check.attributes.length === 0 ? (
                  <span className="cc-muted">{t('customerChecks.detail.noAttributes')}</span>
                ) : (
                  <div className="cc-chips">
                    {check.attributes.map((a, i) => <span key={`${a}-${i}`} className="cc-chip">{a}</span>)}
                  </div>
                )}
              </section>

              {/* 정보 그리드 */}
              <section className="cc-sec">
                <dl className="cc-facts">
                  <dt>{t('customerChecks.col.orderNo')}</dt><dd className="cc-mono">{check.order_no || '–'}</dd>
                  <dt>{t('customerChecks.detail.productNo')}</dt><dd className="cc-mono">{check.product_no || '–'}</dd>
                  <dt>{t('customerChecks.detail.qty')}</dt>
                  <dd>
                    <span className="cc-qty-group">
                      <span>{t('customerChecks.detail.orderQty')} <b>{check.order_qty ?? '–'}</b></span>
                      <span>{t('customerChecks.detail.confirmQty')} <b className="is-accent">{check.confirm_qty ?? '–'}</b></span>
                      <span>{t('customerChecks.detail.arrivalQty')} <b>{check.arrival_qty ?? '–'}</b></span>
                    </span>
                  </dd>
                  <dt>{t('customerChecks.col.size')}</dt><dd><SizeBadge code={check.size_code} /></dd>
                  <dt>{t('customerChecks.col.requestedBy')}</dt><dd>{check.requested_by || '–'}</dd>
                  <dt>{t('customerChecks.col.createdAt')}</dt><dd className="cc-mono">{fmtDateTime(check.created_at)}</dd>
                  {check.closed_at && (<><dt>{t('customerChecks.detail.closedAt')}</dt><dd className="cc-mono">{fmtDateTime(check.closed_at)}</dd></>)}
                  {check.site_url && (
                    <>
                      <dt>{t('customerChecks.detail.siteUrl')}</dt>
                      <dd><a href={check.site_url} target="_blank" rel="noreferrer" className="cc-link">{t('customerChecks.detail.openSite')} ↗</a></dd>
                    </>
                  )}
                </dl>
              </section>

              {/* 같은 아이템번호의 다른 요청 */}
              {data.related.length > 0 && (
                <section className="cc-sec">
                  <div className="cc-sec-title">{t('customerChecks.detail.related', { count: data.related.length })}</div>
                  <ul className="cc-related">
                    {data.related.map((r) => (
                      <li key={r.id}>
                        <button type="button" className="cc-related-btn" onClick={() => onNavigate(r.id)}>
                          <span className="cc-mono">{fmtDateTime(r.created_at)}</span>
                          <TeamBadge code={r.team_code} />
                          <StatusBadge status={r.status} />
                          <DecisionBadge decision={r.decision} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 댓글 */}
              <section className="cc-sec cc-sec-thread">
                <div className="cc-sec-title">{t('customerChecks.detail.comments', { count: data.comments.length })}</div>
                <div className="cc-thread" ref={threadRef}>
                  {data.comments.length === 0 && <div className="cc-muted">{t('customerChecks.detail.noComments')}</div>}
                  {data.comments.map((c) => (
                    <div key={c.id} className={`cc-comment is-${c.author_role}`}>
                      <div className="cc-comment-meta">
                        <span className="cc-comment-role">{t(`customerChecks.role.${c.author_role}`)}</span>
                        {c.author_name && <span className="cc-comment-author">{c.author_name}</span>}
                        <span className="cc-comment-time">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <div className="cc-comment-body">{c.body}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        {/* ── 작성칸 + 동작 ── */}
        {check && (
          <footer className="cc-panel-footer">
            {notice && <div className={`cc-notice is-${notice.kind}`}>{notice.text}</div>}
            <textarea
              className="cc-composer"
              rows={2}
              value={composer}
              maxLength={2000}
              placeholder={t('customerChecks.detail.composerPlaceholder')}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={onComposerKey}
              disabled={!!busy}
            />
            <div className="cc-footer-row">
              <select
                className="cc-author-select"
                value={authorName}
                onChange={(e) => onAuthorChange(e.target.value)}
                disabled={!!busy}
                title={t('customerChecks.detail.author')}
              >
                <option value="">{t('customerChecks.detail.author')}</option>
                {workers.map((w) => {
                  const v = [w.name, w.name_kr].filter(Boolean).join(' ');
                  return <option key={w.id} value={v}>{v}</option>;
                })}
              </select>
              <div className="cc-footer-actions">
                <button type="button" className="cc-btn-ghost" onClick={submitComment} disabled={!!busy}>
                  {busy === 'comment' ? t('customerChecks.saving') : t('customerChecks.detail.addComment')}
                </button>
                {availableActions.includes('recheck') && (
                  <button type="button" className="cc-btn cc-btn-recheck" onClick={() => runAction('recheck')} disabled={!!busy}>
                    {busy === 'recheck' ? t('customerChecks.saving') : t('customerChecks.action.recheck')}
                  </button>
                )}
                {availableActions.includes('close') && (
                  <button type="button" className="cc-btn cc-btn-close" onClick={() => runAction('close')} disabled={!!busy}>
                    {busy === 'close' ? t('customerChecks.saving') : t('customerChecks.action.close')}
                  </button>
                )}
                {availableActions.includes('reopen') && (
                  <button type="button" className="cc-btn cc-btn-reopen" onClick={() => runAction('reopen')} disabled={!!busy}>
                    {busy === 'reopen' ? t('customerChecks.saving') : t('customerChecks.action.reopen')}
                  </button>
                )}
              </div>
            </div>
          </footer>
        )}
      </aside>

      {viewer !== null && imageUrls.length > 0 && (
        <CheckImageViewer
          urls={imageUrls.map((i) => i.url)}
          index={Math.min(viewer, imageUrls.length - 1)}
          onChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
};

export default CheckDetailPanel;
