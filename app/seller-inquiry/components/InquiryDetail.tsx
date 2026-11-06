'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AccountBadge from '../../../component/AccountBadge';
import { copyText } from '../../../lib/clipboard';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { SellerInquiryDetail, SellerInquiryDetailItem } from '../../../lib/sellerInquiries';
import { fetchSellerInquiryDetail } from '../utils/sellerInquiryApi';

// ============================================================
// InquiryDetail — 목록 행 아래 펼침: 주문행 표
//   상태·메모·사진은 목록 행 칸에서 다룬다 (이 영역에는 주문행만)
//   주문ID 옆에 1688 계정 배지 (GET [id] 가 붙여 준 account_badges)
//   [중국옵션] 머리글 📋 = 행마다 `옵션<TAB>확인수량` 을 줄바꿈으로 이어 복사 (시트에 그대로 붙여넣기)
// ============================================================

interface InquiryDetailProps {
  inquiryId: string;
  /** 복사 알림 (useCopyToast.show) */
  notify: (message: string) => void;
}

/** 중국옵션 표시 — 옵션1 / 옵션2 */
const chinaOptionOf = (it: SellerInquiryDetailItem): string =>
  [it.china_option1, it.china_option2].filter(Boolean).join(' / ');

const InquiryDetail: React.FC<InquiryDetailProps> = ({ inquiryId, notify }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<SellerInquiryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 펼칠 때 1번 조회 ──
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchSellerInquiryDetail(inquiryId, t('sellerInquiry.loadError'))
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => {
        console.error('seller-inquiry 상세 오류:', e);
        if (!cancelled) setError(e instanceof Error ? e.message : t('sellerInquiry.loadError'));
      });
    return () => { cancelled = true; };
  }, [inquiryId, t]);

  // ── 중국옵션 + 확인수량 복사 ──
  const copyOptions = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!detail) return;
    try {
      await copyText(detail.items.map((it) => `${chinaOptionOf(it)}\t${it.expected_qty}`).join('\n'));
      notify(t('sellerInquiry.copy.options'));
    } catch (err) {
      console.error('seller-inquiry 중국옵션 복사 오류:', err);
      notify(t('sellerInquiry.copy.failed'));
    }
  };

  if (error) return <div className="si-notice is-error">{error}</div>;
  if (!detail) return <div className="si-detail-loading">{t('sellerInquiry.loading')}</div>;

  return (
    <div className="si-detail-items">
      <table className="si-items-table">
        <thead>
          <tr>
            <th></th>
            <th>{t('sellerInquiry.col.itemNo')}</th>
            <th>{t('sellerInquiry.col.product')}</th>
            <th>
              <span className="si-th-with-copy">
                {t('sellerInquiry.col.option')}
                <button
                  type="button"
                  className="si-copy-btn"
                  onClick={copyOptions}
                  title={t('sellerInquiry.copy.optionsTitle')}
                  aria-label={t('sellerInquiry.copy.optionsTitle')}
                >
                  📋
                </button>
              </span>
            </th>
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
                {it.order_id_1688 && (
                  <div className="si-sub si-order-id">
                    {it.order_id_1688}
                    {(it.account_badges ?? []).map((b) => (
                      <AccountBadge key={b} badge={b} title={t('sellerInquiry.accountTitle', { badge: b })} />
                    ))}
                  </div>
                )}
              </td>
              <td>
                <div>{it.item_name}</div>
                {it.option_name && <div className="si-sub">{it.option_name}</div>}
              </td>
              <td>{chinaOptionOf(it)}</td>
              <td className="si-col-num">{it.expected_qty}</td>
              <td className="si-col-num">{it.arrived_qty}</td>
              <td className="si-col-num si-short">{it.short_qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default InquiryDetail;
