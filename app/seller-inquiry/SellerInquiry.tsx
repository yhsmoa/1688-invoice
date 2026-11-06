'use client';

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopsideMenu from '../../component/TopsideMenu';
import LeftsideMenu from '../../component/LeftsideMenu';
import {
  SELLER_INQUIRY_KINDS,
  SELLER_INQUIRY_STATUSES,
  SELLER_INQUIRY_TABLES,
  type SellerInquiryKind,
  type SellerInquiryListRow,
  type SellerInquiryStatus,
} from '../../lib/sellerInquiries';
import InquiryRow from './components/InquiryRow';
import StatusModal from './components/StatusModal';
import { useCopyToast } from './hooks/useCopyToast';
import { useSellerInquiryList } from './hooks/useSellerInquiryList';
import { KIND_CLASS, SELLER_INQUIRY_COLUMNS, SELLER_INQUIRY_COLUMN_COUNT, STATUS_CLASS, dateLocaleOf } from './utils/display';
import './SellerInquiry.css';

// ============================================================
// /seller-inquiry — 1688 판매자 문의 (창고 PC)
//
//   목록: 배송번호 단위 접수 — 칸 정의는 utils/display SELLER_INQUIRY_COLUMNS
//     [구분] [이미지(hover 확대)] [계정 배지·배송번호 📋·팀] [글번호 외 n건] [입고] [부족] [확인수량]
//     [메모(줄 기록 E/−/+)] [처리상태(누르면 변경 모달, 시각은 툴팁)] [사진 썸네일(클릭 복사·hover 확대·↗)]
//   행을 누르면 아래로 주문행 표 (components/InquiryDetail — 중국옵션 📋)
//   탭 한 줄 = 처리상태 (전체/접수/문의중/처리완료) · 구분 (전체/미입고/확인요청), 검색 = 배송번호·글번호
//   복사 알림 = hooks/useCopyToast (화면 아래 가운데)
//   표만 스크롤되고 헤더·탭·페이지는 고정 (SellerInquiry.css .si-table-wrap)
//   데이터: Supabase manage-item · ft_seller_inquiries / _items / _photos (화면 하단에 표시)
// ============================================================

type StatusTab = 'all' | SellerInquiryStatus;
type KindTab = 'all' | SellerInquiryKind;
const STATUS_TABS: StatusTab[] = ['all', ...SELLER_INQUIRY_STATUSES];
const KIND_TABS: KindTab[] = ['all', ...SELLER_INQUIRY_KINDS];

const sum = (rec: Record<string, number>) => Object.values(rec).reduce((a, b) => a + b, 0);

export default function SellerInquiry() {
  const { t, i18n } = useTranslation();
  const locale = dateLocaleOf(i18n.language);

  // ============================================================
  // 필터 · 목록
  // ============================================================
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [kindTab, setKindTab] = useState<KindTab>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const { rows, total, pageSize, counts, isLoading, error, refresh } = useSellerInquiryList({
    status: statusTab === 'all' ? null : statusTab,
    kind: kindTab === 'all' ? null : kindTab,
    q,
    page,
  });

  // ── 펼친 상세 · 상태 변경 대상 ──
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<SellerInquiryListRow | null>(null);

  // 필터를 바꾸면 1페이지로, 펼친 상세는 닫는다
  const resetView = () => { setPage(1); setOpenId(null); };
  const changeStatusTab = (tb: StatusTab) => { setStatusTab(tb); resetView(); };
  const changeKindTab = (tb: KindTab) => { setKindTab(tb); resetView(); };
  const applySearch = (value: string) => { setQ(value); resetView(); };

  const toggleRow = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
  const closeStatusModal = useCallback(() => setStatusTarget(null), []);

  // ── 복사 알림 ──
  const { show: notify, toastNode } = useCopyToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ============================================================
  // 렌더
  // ============================================================
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
                  onKeyDown={(e) => { if (e.key === 'Enter') applySearch(qInput.trim()); }}
                />
                {q && <button type="button" className="si-search-clear" onClick={() => { setQInput(''); applySearch(''); }} aria-label="clear">×</button>}
              </label>
              <button type="button" className="si-btn" onClick={refresh} disabled={isLoading}>{t('sellerInquiry.refresh')}</button>
            </div>
          </header>

          {/* ── 탭 한 줄: 처리상태 · 구분 ── */}
          <div className="si-tabbar">
            <nav className="si-tabs" aria-label={t('sellerInquiry.tabGroup.status')}>
              <span className="si-tabs-label">{t('sellerInquiry.tabGroup.status')}</span>
              {STATUS_TABS.map((tb) => (
                <button
                  key={tb}
                  type="button"
                  className={`si-tab ${statusTab === tb ? 'is-active' : ''} ${tb !== 'all' ? STATUS_CLASS[tb] : ''}`}
                  onClick={() => changeStatusTab(tb)}
                >
                  {tb === 'all' ? t('sellerInquiry.tabAll') : t(`sellerInquiry.status.${tb}`)}
                  <span className="si-tab-n">{tb === 'all' ? sum(counts.status) : counts.status[tb]}</span>
                </button>
              ))}
            </nav>
            <nav className="si-tabs" aria-label={t('sellerInquiry.tabGroup.kind')}>
              <span className="si-tabs-label">{t('sellerInquiry.tabGroup.kind')}</span>
              {KIND_TABS.map((tb) => (
                <button
                  key={tb}
                  type="button"
                  className={`si-tab ${kindTab === tb ? 'is-active' : ''} ${tb !== 'all' ? KIND_CLASS[tb] : ''}`}
                  onClick={() => changeKindTab(tb)}
                >
                  {tb === 'all' ? t('sellerInquiry.tabAll') : t(`sellerInquiry.kind.${tb}`)}
                  <span className="si-tab-n">{tb === 'all' ? sum(counts.kind) : counts.kind[tb]}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* ── 목록 (이 영역만 스크롤) ── */}
          {error && <div className="si-notice is-error">{error}</div>}
          <div className={`si-table-wrap ${isLoading ? 'is-loading' : ''}`}>
            <table className="si-table">
              <thead>
                <tr>
                  {SELLER_INQUIRY_COLUMNS.map((c) => (
                    <th key={c.key} className={c.className}>{t(c.labelKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={SELLER_INQUIRY_COLUMN_COUNT} className="si-empty">{t('sellerInquiry.empty')}</td></tr>
                )}
                {rows.map((r) => (
                  <InquiryRow
                    key={r.id}
                    row={r}
                    isOpen={openId === r.id}
                    locale={locale}
                    onToggle={toggleRow}
                    onStatusClick={setStatusTarget}
                    onChanged={refresh}
                    notify={notify}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* ── 페이지 ── */}
          {totalPages > 1 && (
            <nav className="si-pager">
              <button type="button" className="si-btn" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); setOpenId(null); }}>‹</button>
              <span>{page} / {totalPages}</span>
              <button type="button" className="si-btn" disabled={page >= totalPages} onClick={() => { setPage((p) => p + 1); setOpenId(null); }}>›</button>
            </nav>
          )}

          {/* ── 데이터 출처 ── */}
          <footer className="si-footer">
            {t('sellerInquiry.dbNote')}: Supabase <b>manage-item</b> · {SELLER_INQUIRY_TABLES.main} · {SELLER_INQUIRY_TABLES.items} · {SELLER_INQUIRY_TABLES.photos}
          </footer>
        </main>
      </div>

      {/* ── 처리상태 변경 모달 ── */}
      <StatusModal inquiry={statusTarget} onClose={closeStatusModal} onChanged={refresh} />

      {/* ── 복사 알림 ── */}
      {toastNode}
    </div>
  );
}
