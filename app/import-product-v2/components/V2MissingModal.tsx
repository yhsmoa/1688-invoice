'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeliveryCodeCandidates } from '../hooks/useDeliveryCodeCandidates';
import type { ShortfallRow } from '../utils/arrivalShortfall';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { SellerInquiryItemInput } from '../../../lib/sellerInquiries';
import './V2MissingModal.css';

// ============================================================
// V2MissingModal — [미입고] 접수 (상품입고 V2/V3)
//
//   검색 결과에서 "입고되어야 할 수량(주문 − 취소)" 보다 "입고 수량(저장된 입고 + 지금
//   작업 열에 넣은 수량)" 이 적은 주문행을 모아 1688 판매자 문의(ft_seller_inquiries)에 접수한다.
//   같은 사용자·같은 배송번호에 열린 접수가 있으면 그 접수의 부족 목록이 이번 내용으로 바뀐다.
//
//   접수 키는 배송번호(운송장 번호)다 — 모바일에서 운송장 바코드를 찍어 사진을 붙이기 때문.
//   · 배송번호 검색 결과: 검색한 번호를 그대로 쓴다 (deliveryCode)
//   · 주문번호·일반·비고 검색 결과 (deliveryCode = null): 결과 주문들의 1688 주문ID 로
//     1688_invoice_deliveryInfo_check 에서 배송번호 후보를 찾아 고르게 한다 (하나면 자동 선택).
//     후보를 고르면 그 배송번호에 속한 주문행만 접수한다 (후보에 없는 번호를 직접 넣으면 전부).
//     후보 찾기는 hooks/useDeliveryCodeCandidates ([1688 판매자 확인] 모달과 공용).
// ============================================================

/** 부족 주문행 — expected/arrived/short 계산은 utils/arrivalShortfall (short > 0 인 행만) */
export type MissingRow = ShortfallRow;

interface V2MissingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 배송번호 검색이면 그 번호, 다른 검색이면 null (모달이 후보를 찾는다) */
  deliveryCode: string | null;
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

  // ── 배송번호 — 검색한 번호가 없으면 결과 주문의 운송장에서 후보를 찾는다 ──
  const orderIds = useMemo(() => rows.map((r) => r.item['1688_order_id']), [rows]);
  const { code, setCode, candidates, loading: isResolving } = useDeliveryCodeCandidates({
    deliveryCode,
    orderIds,
    enabled: isOpen,
  });

  useEffect(() => { if (isOpen) setMemo(''); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isSaving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSaving, onClose]);

  // ── 접수할 행 — 고른 후보 배송번호에 속한 주문행만 (직접 입력한 번호면 전부) ──
  const trimmedCode = code.trim();
  const selectedCandidate = candidates.find((c) => c.code === trimmedCode) ?? null;
  const effectiveRows = useMemo(() => {
    if (!selectedCandidate) return rows;
    const ids = new Set(selectedCandidate.orderIds);
    return rows.filter((r) => ids.has(r.item['1688_order_id'] ?? ''));
  }, [rows, selectedCandidate]);

  if (!isOpen) return null;

  const shortTotal = effectiveRows.reduce((n, r) => n + r.short, 0);

  const submit = async () => {
    if (isSaving || effectiveRows.length === 0) return;
    if (!selectedUserId) { alert(t('importProductV2.alerts.selectUser')); return; }
    if (!trimmedCode) { alert(t('importProductV2.missing.codeRequired')); return; }
    setIsSaving(true);
    try {
      const items: SellerInquiryItemInput[] = effectiveRows.map(({ item, expected, arrived, short }) => ({
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
          delivery_code: trimmedCode,
          kind: '미입고',
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
              <span className="v2-missing-code">{trimmedCode || '—'}</span>
              <span>{t('importProductV2.missing.summary', { lines: effectiveRows.length, qty: shortTotal })}</span>
            </div>
          </div>
          <button type="button" className="v2-missing-close" onClick={onClose} disabled={isSaving} aria-label="close">×</button>
        </div>

        <div className="v2-missing-body">
          <p className="v2-missing-hint">{t('importProductV2.missing.hint')}</p>

          {/* 배송번호 — 배송번호 검색이 아닐 때만 고르거나 입력 */}
          {deliveryCode === null && (
            <div className="v2-missing-codefield">
              <label>
                {t('importProductV2.missing.codeLabel')}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('importProductV2.missing.codePlaceholder')}
                  disabled={isSaving}
                />
              </label>
              <div className="v2-missing-codehint">
                {isResolving ? (
                  t('importProductV2.missing.codeResolving')
                ) : candidates.length > 0 ? (
                  <>
                    {t('importProductV2.missing.codeCandidates')}
                    {candidates.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        className={`v2-missing-codechip ${c.code === trimmedCode ? 'is-active' : ''}`}
                        onClick={() => setCode(c.code)}
                        disabled={isSaving}
                      >
                        {c.code}<small>{c.orderIds.length}</small>
                      </button>
                    ))}
                  </>
                ) : (
                  t('importProductV2.missing.codeNone')
                )}
              </div>
            </div>
          )}

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
              {effectiveRows.map(({ item, expected, arrived, short }) => (
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
          <button type="button" className="v2-missing-btn is-primary" onClick={submit} disabled={isSaving || effectiveRows.length === 0 || !trimmedCode}>
            {isSaving ? t('importProductV2.missing.saving') : t('importProductV2.missing.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2MissingModal;
