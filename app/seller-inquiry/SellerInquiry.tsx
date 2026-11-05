'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import { proxyImageUrl, THUMB_WIDTH } from '../../lib/imageProxy';
import {
  SELLER_INQUIRY_STATUSES,
  SELLER_INQUIRY_TABLES,
  SELLER_INQUIRY_TRANSITIONS,
  type SellerInquiryDetail,
  type SellerInquiryListRow,
  type SellerInquiryStatus,
} from '../../lib/sellerInquiries';
import './SellerInquiry.css';

// ============================================================
// /seller-inquiry — 1688 판매자 문의 (창고 PC)
//
//   목록: 배송번호 단위 접수. [이미지] [배송번호·팀] [글번호 외 n건] [입고] [부족] [입고되어야 할 수량] [메모] [상태·시각] [사진]
//   행을 누르면 아래로 부족 주문행 목록 + 사진 + 메모 편집 + 상태 전이 버튼
//   상단 탭 = 상태 (전체 / 접수 / 문의중 / 처리완료), 검색 = 배송번호·글번호
//   데이터: Supabase manage-item · ft_seller_inquiries / _items / _photos (화면 하단에 표시)
// ============================================================

type Tab = 'all' | SellerInquiryStatus;
const TABS: Tab[] = ['all', ...SELLER_INQUIRY_STATUSES];

interface ListResponse {
  success: boolean;
  rows: SellerInquiryListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  error?: string;
}

export default function SellerInquiry() {
  const { t, i18n } = useTranslation();

  // ── 필터 ──
  const [tab, setTab] = useState<Tab>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  // ── 목록 ──
  const [rows, setRows] = useState<SellerInquiryListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (tab !== 'all') params.set('status', tab);
      if (q) params.set('q', q);
      const res = await fetch(`/api/ft/seller-inquiries?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json.success) throw new Error(json.error || t('sellerInquiry.loadError'));
      setRows(json.rows);
      setTotal(json.total);
      setPageSize(json.pageSize);
      setCounts(json.counts);
    } catch (e) {
      console.error('seller-inquiry 목록 오류:', e);
      setRows([]);
      setError(e instanceof Error ? e.message : t('sellerInquiry.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [tab, q, page, t]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── 상세 (펼침) ──
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SellerInquiryDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');

  const openDetail = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id);
    setDetail(null);
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/ft/seller-inquiries/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('sellerInquiry.loadError'));
      setDetail(json.inquiry as SellerInquiryDetail);
      setMemoDraft((json.inquiry as SellerInquiryDetail).memo ?? '');
    } catch (e) {
      console.error('seller-inquiry 상세 오류:', e);
      alert(e instanceof Error ? e.message : t('sellerInquiry.loadError'));
      setOpenId(null);
    } finally {
      setDetailBusy(false);
    }
  }, [openId, t]);

  const patchDetail = useCallback(async (body: { status?: SellerInquiryStatus; memo?: string | null }) => {
    if (!detail) return;
    setDetailBusy(true);
    try {
      const res = await fetch(`/api/ft/seller-inquiries/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('sellerInquiry.saveError'));
      setDetail(json.inquiry as SellerInquiryDetail);
      setMemoDraft((json.inquiry as SellerInquiryDetail).memo ?? '');
      await fetchList();
    } catch (e) {
      console.error('seller-inquiry 저장 오류:', e);
      alert(e instanceof Error ? e.message : t('sellerInquiry.saveError'));
    } finally {
      setDetailBusy(false);
    }
  }, [detail, fetchList, t]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const locale = i18n.language === 'zh' ? 'zh-CN' : 'ko-KR';
  const fmt = useMemo(
    () => (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'),
    [locale]
  );
  const statusClass = (s: SellerInquiryStatus) => (s === '문의중' ? 'is-inq' : s === '처리완료' ? 'is-done' : 'is-new');

  return (
    <div className="app-layout">
      <TopsideMenu />
      <div className="main-content">
        <LeftsideMenu />
        <main className="si-main">
          {/* ── 헤더 ── */}
          <header className="si-header">
            <div>
              <h1 className="si-title">{t('menu.sellerInquiry')}</h1>
              <p className="si-subtitle">{t('sellerInquiry.subtitle')}</p>
            </div>
            <div className="si-tools">
              <label className="si-search">
                <input
                  type="text"
                  value={qInput}
                  placeholder={t('sellerInquiry.searchPlaceholder')}
                  onChange={(e) => setQInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setQ(qInput.trim()); setPage(1); } }}
                />
                {q && <button type="button" className="si-search-clear" onClick={() => { setQInput(''); setQ(''); setPage(1); }} aria-label="clear">×</button>}
              </label>
              <button type="button" className="si-btn" onClick={fetchList} disabled={isLoading}>{t('sellerInquiry.refresh')}</button>
            </div>
          </header>

          {/* ── 상태 탭 ── */}
          <nav className="si-tabs" aria-label="status">
            {TABS.map((tb) => {
              const n = tb === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[tb] ?? 0);
              return (
                <button
                  key={tb}
                  type="button"
                  className={`si-tab ${tab === tb ? 'is-active' : ''} ${tb !== 'all' ? statusClass(tb) : ''}`}
                  onClick={() => { setTab(tb); setPage(1); setOpenId(null); setDetail(null); }}
                >
                  {tb === 'all' ? t('sellerInquiry.tabAll') : t(`sellerInquiry.status.${tb}`)}
                  <span className="si-tab-n">{n}</span>
                </button>
              );
            })}
          </nav>

          {/* ── 목록 ── */}
          {error && <div className="si-notice is-error">{error}</div>}
          <div className={`si-table-wrap ${isLoading ? 'is-loading' : ''}`}>
            <table className="si-table">
              <thead>
                <tr>
                  <th className="si-col-img">{t('sellerInquiry.col.image')}</th>
                  <th>{t('sellerInquiry.col.delivery')}</th>
                  <th>{t('sellerInquiry.col.items')}</th>
                  <th className="si-col-num">{t('sellerInquiry.col.arrived')}</th>
                  <th className="si-col-num">{t('sellerInquiry.col.short')}</th>
                  <th className="si-col-num">{t('sellerInquiry.col.expected')}</th>
                  <th>{t('sellerInquiry.col.memo')}</th>
                  <th>{t('sellerInquiry.col.status')}</th>
                  <th className="si-col-num">{t('sellerInquiry.col.photos')}</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={9} className="si-empty">{t('sellerInquiry.empty')}</td></tr>
                )}
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className={`si-row ${openId === r.id ? 'is-open' : ''}`} onClick={() => openDetail(r.id)}>
                      <td className="si-col-img">
                        {r.first_img_url ? <img src={proxyImageUrl(r.first_img_url, THUMB_WIDTH)} alt="" loading="lazy" /> : <span className="si-noimg">-</span>}
                      </td>
                      <td>
                        <div className="si-code">{r.delivery_code}</div>
                        <span className="si-team">{r.team_code}</span>
                        {r.created_by && <span className="si-by">{r.created_by}</span>}
                      </td>
                      <td>
                        <div className="si-items-label">
                          <span className="si-item-no">{r.first_item_no ?? '-'}</span>
                          {r.item_count > 1 && <span className="si-more">{t('sellerInquiry.andMore', { count: r.item_count - 1 })}</span>}
                        </div>
                      </td>
                      <td className="si-col-num">{r.arrived_total}</td>
                      <td className="si-col-num si-short">{r.short_total}</td>
                      <td className="si-col-num">{r.expected_total}</td>
                      <td className="si-memo-cell" title={r.memo ?? ''}>{r.memo ?? ''}</td>
                      <td>
                        <span className={`si-status ${statusClass(r.status)}`}>{t(`sellerInquiry.status.${r.status}`)}</span>
                        <div className="si-times">
                          <span>{t('sellerInquiry.receivedAt')} {fmt(r.received_at)}</span>
                          {r.inquiring_at && <span>{t('sellerInquiry.inquiringAt')} {fmt(r.inquiring_at)}</span>}
                          {r.completed_at && <span>{t('sellerInquiry.completedAt')} {fmt(r.completed_at)}</span>}
                        </div>
                      </td>
                      <td className="si-col-num">{r.photo_count > 0 ? `📷 ${r.photo_count}` : ''}</td>
                    </tr>

                    {/* ── 상세 ── */}
                    {openId === r.id && (
                      <tr className="si-detail-row">
                        <td colSpan={9}>
                          {!detail ? (
                            <div className="si-detail-loading">{t('sellerInquiry.loading')}</div>
                          ) : (
                            <div className="si-detail">
                              <div className="si-detail-items">
                                <table className="si-items-table">
                                  <thead>
                                    <tr>
                                      <th></th>
                                      <th>{t('sellerInquiry.col.itemNo')}</th>
                                      <th>{t('sellerInquiry.col.product')}</th>
                                      <th>{t('sellerInquiry.col.option')}</th>
                                      <th className="si-col-num">{t('sellerInquiry.col.expected')}</th>
                                      <th className="si-col-num">{t('sellerInquiry.col.arrived')}</th>
                                      <th className="si-col-num">{t('sellerInquiry.col.short')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.items.map((it) => (
                                      <tr key={it.id}>
                                        <td className="si-col-img">{it.img_url ? <img src={proxyImageUrl(it.img_url, THUMB_WIDTH)} alt="" loading="lazy" /> : <span className="si-noimg">-</span>}</td>
                                        <td>
                                          <div className="si-item-no">{it.item_no}</div>
                                          {it.order_id_1688 && <div className="si-sub">{it.order_id_1688}</div>}
                                        </td>
                                        <td>
                                          <div>{it.item_name}</div>
                                          {it.option_name && <div className="si-sub">{it.option_name}</div>}
                                        </td>
                                        <td>{[it.china_option1, it.china_option2].filter(Boolean).join(' / ')}</td>
                                        <td className="si-col-num">{it.expected_qty}</td>
                                        <td className="si-col-num">{it.arrived_qty}</td>
                                        <td className="si-col-num si-short">{it.short_qty}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              <aside className="si-detail-side">
                                {/* 상태 전이 */}
                                <div className="si-side-block">
                                  <h4>{t('sellerInquiry.col.status')}</h4>
                                  <div className="si-side-status">
                                    <span className={`si-status ${statusClass(detail.status)}`}>{t(`sellerInquiry.status.${detail.status}`)}</span>
                                    {SELLER_INQUIRY_TRANSITIONS[detail.status].map((next) => (
                                      <button
                                        key={next}
                                        type="button"
                                        className={`si-btn ${next === '처리완료' ? 'is-primary' : ''}`}
                                        disabled={detailBusy}
                                        onClick={() => patchDetail({ status: next })}
                                      >
                                        {t(`sellerInquiry.to.${next}`)}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="si-times si-times-detail">
                                    <span>{t('sellerInquiry.receivedAt')} {fmt(detail.received_at)}</span>
                                    <span>{t('sellerInquiry.inquiringAt')} {fmt(detail.inquiring_at)}</span>
                                    <span>{t('sellerInquiry.completedAt')} {fmt(detail.completed_at)}</span>
                                  </div>
                                </div>

                                {/* 메모 */}
                                <div className="si-side-block">
                                  <h4>{t('sellerInquiry.col.memo')}</h4>
                                  <textarea
                                    className="si-memo"
                                    rows={3}
                                    value={memoDraft}
                                    onChange={(e) => setMemoDraft(e.target.value)}
                                    placeholder={t('sellerInquiry.memoPlaceholder')}
                                  />
                                  <button
                                    type="button"
                                    className="si-btn"
                                    disabled={detailBusy || memoDraft.trim() === (detail.memo ?? '')}
                                    onClick={() => patchDetail({ memo: memoDraft.trim() || null })}
                                  >
                                    {t('sellerInquiry.saveMemo')}
                                  </button>
                                </div>

                                {/* 사진 */}
                                <div className="si-side-block">
                                  <h4>{t('sellerInquiry.col.photos')} ({detail.photos.length})</h4>
                                  {detail.photos.length === 0 ? (
                                    <p className="si-sub">{t('sellerInquiry.noPhotos')}</p>
                                  ) : (
                                    <div className="si-photos">
                                      {detail.photos.map((p) => (
                                        <a key={p.id} href={p.public_url} target="_blank" rel="noopener noreferrer" title={`${p.taken_by ?? ''} ${fmt(p.created_at)}`}>
                                          <img src={p.public_url} alt="" loading="lazy" />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </aside>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 페이지 ── */}
          {totalPages > 1 && (
            <nav className="si-pager">
              <button type="button" className="si-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              <span>{page} / {totalPages}</span>
              <button type="button" className="si-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
            </nav>
          )}

          {/* ── 데이터 출처 ── */}
          <footer className="si-footer">
            {t('sellerInquiry.dbNote')}: Supabase <b>manage-item</b> · {SELLER_INQUIRY_TABLES.main} · {SELLER_INQUIRY_TABLES.items} · {SELLER_INQUIRY_TABLES.photos}
          </footer>
        </main>
      </div>
    </div>
  );
}
