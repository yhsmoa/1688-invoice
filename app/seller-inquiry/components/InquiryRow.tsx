'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import AccountBadge from '../../../component/AccountBadge';
import HoverZoomImage from '../../../component/HoverZoomImage';
import { copyImage, copyText } from '../../../lib/clipboard';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { SellerInquiryListRow } from '../../../lib/sellerInquiries';
import {
  KIND_CLASS,
  SELLER_INQUIRY_COLUMN_COUNT,
  STATUS_CLASS,
  formatShortDateTime,
} from '../utils/display';
import InquiryDetail from './InquiryDetail';
import MemoCell from './MemoCell';

// ============================================================
// InquiryRow — 목록 1행 (+ 펼친 상세 행)
//   칸 순서는 utils/display SELLER_INQUIRY_COLUMNS 와 같다:
//   [구분] [이미지] [배송번호·계정·팀] [글번호] [입고] [부족] [확인수량] [메모] [처리상태] [사진]
//   행 클릭 = 상세 펼침/접기. 아래는 행 클릭으로 번지지 않는다 (stopPropagation):
//     [배송번호] 📋 = 배송번호 복사 · [메모] 칸 전체 · [처리상태] 칸 = 상태 변경 모달
//     [사진] 썸네일 = 이미지 복사 (안 되면 URL 복사) · ↗ = 원본 새 탭
//   [이미지] · [사진] 은 마우스를 올리면 확대 (component/HoverZoomImage)
//   [처리상태] 칸의 접수·문의중·처리완료 시각은 버튼 title(툴팁)에만
//   [부족] 은 확인요청이면 — (확인요청의 부족 수량은 정의상 0)
// ============================================================

interface InquiryRowProps {
  row: SellerInquiryListRow;
  isOpen: boolean;
  locale: string;
  onToggle: (id: string) => void;
  onStatusClick: (row: SellerInquiryListRow) => void;
  onChanged: () => void | Promise<void>;
  /** 복사 알림 (useCopyToast.show) */
  notify: (message: string) => void;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const InquiryRow: React.FC<InquiryRowProps> = ({ row: r, isOpen, locale, onToggle, onStatusClick, onChanged, notify }) => {
  const { t } = useTranslation();
  const extraPhotos = r.photo_count - r.photo_urls.length;

  // ── 처리상태 툴팁 (한 줄) ──
  const statusTitle = [
    `${t('sellerInquiry.receivedAt')} ${formatShortDateTime(r.received_at, locale)}`,
    r.inquiring_at && `${t('sellerInquiry.inquiringAt')} ${formatShortDateTime(r.inquiring_at, locale)}`,
    r.completed_at && `${t('sellerInquiry.completedAt')} ${formatShortDateTime(r.completed_at, locale)}`,
  ].filter(Boolean).join(' · ');

  // ============================================================
  // 복사
  // ============================================================
  const copyCode = async (e: React.MouseEvent) => {
    stop(e);
    try {
      await copyText(r.delivery_code);
      notify(t('sellerInquiry.copy.done'));
    } catch (err) {
      console.error('seller-inquiry 배송번호 복사 오류:', err);
      notify(t('sellerInquiry.copy.failed'));
    }
  };

  const copyPhoto = async (e: React.MouseEvent, url: string) => {
    stop(e);
    try {
      const kind = await copyImage(url);
      notify(kind === 'image' ? t('sellerInquiry.copy.image') : t('sellerInquiry.copy.imageUrl'));
    } catch (err) {
      console.error('seller-inquiry 사진 복사 오류:', err);
      notify(t('sellerInquiry.copy.failed'));
    }
  };

  return (
    <>
      <tr className={`si-row ${isOpen ? 'is-open' : ''}`} onClick={() => onToggle(r.id)}>
        {/* ── 구분 ── */}
        <td className="si-col-kind">
          <span className={`si-kind ${KIND_CLASS[r.kind] ?? ''}`}>{t(`sellerInquiry.kind.${r.kind}`)}</span>
        </td>

        {/* ── 이미지 (hover 확대) ── */}
        <td className="si-col-img">
          {r.first_img_url ? (
            <HoverZoomImage
              className="si-thumb"
              src={proxyImageUrl(r.first_img_url, THUMB_WIDTH)}
              fullSrc={proxyImageUrl(r.first_img_url)}
            />
          ) : (
            <span className="si-noimg">-</span>
          )}
        </td>

        {/* ── 1688 계정 · 배송번호 · 복사 · 팀 · 접수자 ── */}
        <td>
          <div className="si-code-line">
            {r.account_badges.map((b) => (
              <AccountBadge key={b} badge={b} title={t('sellerInquiry.accountTitle', { badge: b })} />
            ))}
            <span className="si-code">{r.delivery_code}</span>
            <button
              type="button"
              className="si-copy-btn"
              onClick={copyCode}
              title={t('sellerInquiry.copy.code')}
              aria-label={t('sellerInquiry.copy.code')}
            >
              📋
            </button>
          </div>
          <span className="si-team">{r.team_code}</span>
          {r.created_by && <span className="si-by">{r.created_by}</span>}
        </td>

        {/* ── 글번호 ── */}
        <td>
          <div className="si-items-label">
            <span className="si-item-no">{r.first_item_no ?? '-'}</span>
            {r.item_count > 1 && <span className="si-more">{t('sellerInquiry.andMore', { count: r.item_count - 1 })}</span>}
          </div>
        </td>

        {/* ── 수량 ── */}
        <td className="si-col-num">{r.arrived_total}</td>
        <td className="si-col-num si-short">{r.kind === '확인요청' ? <span className="si-na">—</span> : r.short_total}</td>
        <td className="si-col-num">{r.expected_total}</td>

        {/* ── 메모 (줄 기록) ── */}
        <MemoCell inquiryId={r.id} memo={r.memo} onSaved={onChanged} />

        {/* ── 처리상태 (누르면 변경 모달 · 시각은 툴팁) ── */}
        <td className="si-status-cell" onClick={(e) => { stop(e); onStatusClick(r); }}>
          <button type="button" className={`si-status ${STATUS_CLASS[r.status]}`} title={statusTitle}>
            {t(`sellerInquiry.status.${r.status}`)}
            <span className="si-status-caret" aria-hidden="true">▾</span>
          </button>
        </td>

        {/* ── 사진 (최대 3장 + n) — 클릭 = 복사 · ↗ = 원본 ── */}
        <td className="si-col-photos">
          {r.photo_urls.length === 0 ? (
            <span className="si-photo-none">—</span>
          ) : (
            <div className="si-photo-strip">
              {r.photo_urls.map((url) => (
                <span key={url} className="si-photo-item">
                  <HoverZoomImage
                    className="si-photo-thumb"
                    src={url}
                    fullSrc={url}
                    title={t('sellerInquiry.copy.photoHint')}
                    onClick={(e) => copyPhoto(e, url)}
                  />
                  <a
                    className="si-photo-open"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={stop}
                    title={t('sellerInquiry.photoOpen')}
                    aria-label={t('sellerInquiry.photoOpen')}
                  >
                    ↗
                  </a>
                </span>
              ))}
              {extraPhotos > 0 && <span className="si-photo-more">{t('sellerInquiry.photoMore', { count: extraPhotos })}</span>}
            </div>
          )}
        </td>
      </tr>

      {/* ── 상세 (주문행 표) ── */}
      {isOpen && (
        <tr className="si-detail-row">
          <td colSpan={SELLER_INQUIRY_COLUMN_COUNT}>
            <InquiryDetail inquiryId={r.id} notify={notify} />
          </td>
        </tr>
      )}
    </>
  );
};

export default InquiryRow;
