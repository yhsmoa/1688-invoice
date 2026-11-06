'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeliveryCodeCandidates } from '../hooks/useDeliveryCodeCandidates';
import type { ShortfallRow } from '../utils/arrivalShortfall';
import { proxyImageUrl, THUMB_WIDTH } from '../../../lib/imageProxy';
import type { SellerInquiryItemInput, SellerInquiryKind } from '../../../lib/sellerInquiries';
import './V2MissingModal.css';
import './V2SellerCheckModal.css';

// ============================================================
// V2SellerCheckModal — [1688 판매자 확인] 확인요청 접수 (상품입고 V2/V3)
//
//   체크한 주문행을 1688 판매자 문의(ft_seller_inquiries)에 kind '확인요청' 으로 접수한다.
//   · 요청 1번 = 접수 1건 — 미입고처럼 열린 접수를 갱신하지 않는다 (API 가 항상 새로 만든다)
//   · 내용(memo) 필수 — 판매자에게 무엇을 확인할지가 접수의 본문이다
//   · 확인수량: 행마다 작업자가 입력한다 (1 이상 정수). 처음 값은 [미입고] 와 같은 계산의
//     입고되어야 할 수량 (utils/arrivalShortfall expected, 0 이면 1).
//     보내는 값: expected_qty = 입력한 확인수량 · arrived_qty = 실제 입고 수량(계산값 그대로) · short_qty = 0
//     (확인요청은 부족 계산 대상이 아니다 — 서버 POST 검증도 같은 규칙)
//
//   배송번호: 배송번호 검색이면 그 번호, 아니면 선택한 주문의 1688 주문ID 로 후보를 찾는다
//   (hooks/useDeliveryCodeCandidates — [미입고] 모달과 공용). [미입고] 와 달리 후보를 골라도
//   주문행을 거르지 않는다 — 사용자가 직접 체크한 행이 그대로 요청 대상이다.
//
//   화면 틀·표·버튼은 V2MissingModal.css 클래스를 그대로 쓰고, 다른 부분만 V2SellerCheckModal.css.
// ============================================================

const KIND: SellerInquiryKind = '확인요청';

/** 확인수량 입력 → 1 이상 정수면 그 값, 아니면 null */
const parseConfirmQty = (raw: string | undefined): number | null => {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

interface V2SellerCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 배송번호 검색이면 그 번호, 다른 검색이면 null (모달이 후보를 찾는다) */
  deliveryCode: string | null;
  /** 체크한 주문행 + 수량 */
  rows: ShortfallRow[];
  selectedUserId: string;
  selectedWorker: string;
  /** 접수 성공 후 (모달은 닫힌다) */
  onSaved?: (result: { id: string; itemCount: number }) => void;
}

const V2SellerCheckModal: React.FC<V2SellerCheckModalProps> = ({
  isOpen, onClose, deliveryCode, rows, selectedUserId, selectedWorker, onSaved,
}) => {
  const { t } = useTranslation();
  const [memo, setMemo] = useState('');
  /** 행별 확인수량 입력 (order item id → 입력 문자열) — 손대지 않은 행은 confirmQtyText 의 기본값 */
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ============================================================
  // 배송번호 후보
  // ============================================================
  const orderIds = useMemo(() => rows.map((r) => r.item['1688_order_id']), [rows]);
  const { code, setCode, candidates, loading: isResolving } = useDeliveryCodeCandidates({
    deliveryCode,
    orderIds,
    enabled: isOpen,
  });

  // ── 열 때 초기화 ──
  useEffect(() => {
    if (!isOpen) return;
    setMemo('');
    setQtyById({});
  }, [isOpen]);

  // ── Escape 로 닫기 (저장 중 제외) ──
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isSaving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  // ── 확인수량 — 입력값, 없으면 입고되어야 할 수량 (0 이면 1) ──
  const confirmQtyText = (r: ShortfallRow): string => qtyById[r.item.id] ?? String(Math.max(1, r.expected));

  const trimmedCode = code.trim();
  const trimmedMemo = memo.trim();
  /** 행 순서대로 확인수량 (잘못된 입력은 null) */
  const confirmQtys = rows.map((r) => parseConfirmQty(confirmQtyText(r)));
  const qtyValid = confirmQtys.every((q) => q !== null);
  const canSubmit = !isSaving && rows.length > 0 && !!trimmedCode && !!trimmedMemo && qtyValid;

  // ============================================================
  // 접수
  // ============================================================
  const submit = async () => {
    if (isSaving || rows.length === 0) return;
    if (!selectedUserId) { alert(t('importProductV2.alerts.selectUser')); return; }
    if (!trimmedCode) { alert(t('importProductV2.sellerCheck.codeRequired')); return; }
    if (!trimmedMemo) { alert(t('importProductV2.sellerCheck.memoRequired')); return; }
    if (!qtyValid) { alert(t('importProductV2.sellerCheck.confirmQtyInvalid')); return; }
    setIsSaving(true);
    try {
      // qtyValid 를 위에서 확인했으므로 confirmQtys 는 모두 1 이상 정수다
      const items: SellerInquiryItemInput[] = rows.map(({ item, arrived }, i) => ({
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
        expected_qty: confirmQtys[i] as number,
        arrived_qty: arrived,
        short_qty: 0,
      }));
      const res = await fetch('/api/ft/seller-inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: KIND,
          user_id: selectedUserId,
          created_by: selectedWorker || null,
          delivery_code: trimmedCode,
          memo: trimmedMemo,
          items,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('importProductV2.sellerCheck.failed'));
      alert(t('importProductV2.sellerCheck.saved', { count: json.item_count }));
      onSaved?.({ id: json.id, itemCount: json.item_count });
      onClose();
    } catch (e) {
      console.error('판매자 확인요청 접수 오류:', e);
      alert(e instanceof Error ? e.message : t('importProductV2.sellerCheck.failed'));
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="v2-missing-overlay" onClick={() => { if (!isSaving) onClose(); }}>
      <div className="v2-missing-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <div className="v2-missing-header">
          <div>
            <h2>{t('importProductV2.sellerCheck.title')}</h2>
            <div className="v2-missing-sub">
              <span className="v2-missing-code">{trimmedCode || '—'}</span>
              <span>{t('importProductV2.sellerCheck.summary', { count: rows.length })}</span>
            </div>
          </div>
          <button type="button" className="v2-missing-close" onClick={onClose} disabled={isSaving} aria-label="close">×</button>
        </div>

        <div className="v2-missing-body">
          <p className="v2-missing-hint">{t('importProductV2.sellerCheck.hint')}</p>

          {/* ── 배송번호 — 배송번호 검색이 아닐 때만 고르거나 입력 ── */}
          {deliveryCode === null && (
            <div className="v2-missing-codefield">
              <label>
                <span>
                  {t('importProductV2.sellerCheck.codeLabel')}
                  <em className="v2-sc-required">{t('importProductV2.sellerCheck.required')}</em>
                </span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('importProductV2.sellerCheck.codePlaceholder')}
                  disabled={isSaving}
                />
              </label>
              <div className="v2-missing-codehint">
                {isResolving ? (
                  t('importProductV2.sellerCheck.codeResolving')
                ) : candidates.length > 0 ? (
                  <>
                    {t('importProductV2.sellerCheck.codeCandidates')}
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
                  t('importProductV2.sellerCheck.codeNone')
                )}
              </div>
            </div>
          )}

          {/* ── 선택한 주문행 ── */}
          <table className="v2-missing-table">
            <thead>
              <tr>
                <th>{t('importProductV2.sellerCheck.colImage')}</th>
                <th>{t('importProductV2.sellerCheck.colItemNo')}</th>
                <th>{t('importProductV2.sellerCheck.colProductNo')}</th>
                <th>{t('importProductV2.sellerCheck.colProduct')}</th>
                <th>{t('importProductV2.sellerCheck.colChinaOption')}</th>
                <th>{t('importProductV2.sellerCheck.colConfirmQty')}</th>
                <th>{t('importProductV2.sellerCheck.colUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { item } = row;
                const qtyText = confirmQtyText(row);
                return (
                <tr key={item.id}>
                  <td>{item.img_url ? <img src={proxyImageUrl(item.img_url, THUMB_WIDTH)} alt="" loading="lazy" /> : <span className="v2-missing-noimg">-</span>}</td>
                  <td className="v2-missing-itemno">{item.item_no}</td>
                  <td className="v2-sc-productno">{item.product_no ?? '-'}</td>
                  <td>
                    <div>{item.item_name}</div>
                    {item.option_name && <div className="v2-missing-opt">{item.option_name}</div>}
                  </td>
                  <td>{[item.china_option1, item.china_option2].filter(Boolean).join(' / ')}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      className={`v2-sc-qty ${parseConfirmQty(qtyText) === null ? 'is-invalid' : ''}`}
                      value={qtyText}
                      onChange={(e) => setQtyById((cur) => ({ ...cur, [item.id]: e.target.value }))}
                      disabled={isSaving}
                      aria-label={t('importProductV2.sellerCheck.colConfirmQty')}
                    />
                  </td>
                  <td>
                    {item.site_url ? (
                      <a className="v2-sc-url" href={item.site_url} target="_blank" rel="noopener noreferrer" title={item.site_url}>
                        {t('importProductV2.sellerCheck.openUrl')}
                      </a>
                    ) : (
                      <span className="v2-missing-opt">-</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>

          {!qtyValid && <p className="v2-sc-qty-hint">{t('importProductV2.sellerCheck.confirmQtyInvalid')}</p>}

          {/* ── 내용 (필수) ── */}
          <label className="v2-missing-memo">
            <span>
              {t('importProductV2.sellerCheck.memo')}
              <em className="v2-sc-required">{t('importProductV2.sellerCheck.required')}</em>
            </span>
            <textarea
              rows={3}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={t('importProductV2.sellerCheck.memoPlaceholder')}
              disabled={isSaving}
            />
          </label>
        </div>

        {/* ── 푸터 ── */}
        <div className="v2-missing-footer">
          <button type="button" className="v2-missing-btn" onClick={onClose} disabled={isSaving}>{t('importProductV2.sellerCheck.cancel')}</button>
          <button type="button" className="v2-missing-btn is-primary" onClick={submit} disabled={!canSubmit}>
            {isSaving ? t('importProductV2.sellerCheck.saving') : t('importProductV2.sellerCheck.submit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default V2SellerCheckModal;
