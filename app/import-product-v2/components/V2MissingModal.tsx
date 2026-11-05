'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../hooks/useFtData';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { SellerInquiryItemInput } from '../../../lib/sellerInquiries';
import './V2MissingModal.css';

// ============================================================
// V2MissingModal — [미입고] 접수 (상품입고 V2/V3)
//
//   배송번호로 검색한 결과에서 "입고되어야 할 수량(주문 − 취소)" 보다 "입고 수량(저장된 입고 + 지금
//   작업 열에 넣은 수량)" 이 적은 주문행을 모아 1688 판매자 문의(ft_seller_inquiries)에 접수한다.
//   같은 사용자·같은 배송번호에 열린 접수가 있으면 그 접수의 부족 목록이 이번 내용으로 바뀐다.
// ============================================================

export interface MissingRow {
  item: FtOrderItem;
  /** 입고되어야 할 수량 = order_qty − CANCEL */
  expected: number;
  /** 입고 수량 = ARRIVAL + 작업 입력 */
  arrived: number;
  /** 부족 = expected − arrived (> 0) */
  short: number;
}

interface V2MissingModalProps {
  isOpen: boolean;
  onClose: () => void;
  deliveryCode: string;
  rows: MissingRow[];
  selectedUserId: string;
  selectedWorker: string;
  /** 접수 성공 후 (모달은 닫힌다) — 필요한 화면만 넘긴다 */
  onSaved?: (result: { id: string; created: boolean; itemCount: number }) => void;
}

const V2MissingModal: React.FC<V2MissingModalProps> = ({
  isOpen, onClose, deliveryCode, rows, selectedUserId, selectedWorker, onSaved,
}) => {
  const { t } = useTranslation();
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { if (isOpen) setMemo(''); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isSaving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const shortTotal = rows.reduce((n, r) => n + r.short, 0);

  const submit = async () => {
    if (isSaving || rows.length === 0) return;
    if (!selectedUserId) { alert(t('importProductV2.alerts.selectUser')); return; }
    setIsSaving(true);
    try {
      const items: SellerInquiryItemInput[] = rows.map(({ item, expected, arrived, short }) => ({
        order_item_id: item.id,
        order_no: item.order_no,
        item_no: item.item_no,
        product_no: item.product_no,
        item_name: item.item_name,
        option_name: item.option_name,
        china_option1: item.china_option1,
        china_option2: item.china_option2,
        img_url: item.img_url,
        site_url: item.site_url,
        order_id_1688: item['1688_order_id'],
        expected_qty: expected,
        arrived_qty: arrived,
        short_qty: short,
      }));
      const res = await fetch('/api/ft/seller-inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId,
          created_by: selectedWorker || null,
          delivery_code: deliveryCode,
          memo: memo.trim() || null,
          items,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('importProductV2.missing.failed'));
      alert(t(json.created ? 'importProductV2.missing.saved' : 'importProductV2.missing.updated', { count: json.item_count }));
      onSaved?.({ id: json.id, created: !!json.created, itemCount: json.item_count });
      onClose();
    } catch (e) {
      console.error('미입고 접수 오류:', e);
      alert(e instanceof Error ? e.message : t('importProductV2.missing.failed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="v2-missing-overlay" onClick={() => { if (!isSaving) onClose(); }}>
      <div className="v2-missing-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="v2-missing-header">
          <div>
            <h2>{t('importProductV2.missing.title')}</h2>
            <div className="v2-missing-sub">
              <span className="v2-missing-code">{deliveryCode}</span>
              <span>{t('importProductV2.missing.summary', { lines: rows.length, qty: shortTotal })}</span>
            </div>
          </div>
          <button type="button" className="v2-missing-close" onClick={onClose} disabled={isSaving} aria-label="close">×</button>
        </div>

        <div className="v2-missing-body">
          <p className="v2-missing-hint">{t('importProductV2.missing.hint')}</p>
          <table className="v2-missing-table">
            <thead>
              <tr>
                <th></th>
                <th>{t('importProduct.table.orderNumber')}</th>
                <th>{t('importProduct.table.productName')}</th>
                <th>{t('importProduct.table.orderOption')}</th>
                <th className="num">{t('importProductV2.missing.expected')}</th>
                <th className="num">{t('importProductV2.missing.arrived')}</th>
                <th className="num">{t('importProductV2.missing.short')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, expected, arrived, short }) => (
                <tr key={item.id}>
                  <td>{item.img_url ? <img src={proxyImageUrl(item.img_url, THUMB_WIDTH)} alt="" loading="lazy" /> : <span className="v2-missing-noimg">-</span>}</td>
                  <td className="v2-missing-itemno">{item.item_no}</td>
                  <td>
                    <div>{item.item_name}</div>
                    {item.option_name && <div className="v2-missing-opt">{item.option_name}</div>}
                  </td>
                  <td>{[item.china_option1, item.china_option2].filter(Boolean).join(' / ')}</td>
                  <td className="num">{expected}</td>
                  <td className="num">{arrived}</td>
                  <td className="num v2-missing-short">{short}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="v2-missing-memo">
            {t('importProductV2.missing.memo')}
            <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={t('importProductV2.missing.memoPlaceholder')} />
          </label>
        </div>

        <div className="v2-missing-footer">
          <button type="button" className="v2-missing-btn" onClick={onClose} disabled={isSaving}>{t('importProductV2.missing.cancel')}</button>
          <button type="button" className="v2-missing-btn is-primary" onClick={submit} disabled={isSaving || rows.length === 0}>
            {isSaving ? t('importProductV2.missing.saving') : t('importProductV2.missing.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2MissingModal;
