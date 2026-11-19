'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BoxInfoItem } from '../../shipment-v2/types';
import { useStorage } from '../hooks/StorageContext';
import type { PickInput, StockRow, WowLine } from '../types';
import ProductCell from './ProductCell';
import BoxField from './BoxField';
import { playErrorSound } from '../utils/storageFormat';
import { planPicks, stockCellsOf } from '../utils/wowStage';
// 상품별 묶음 · 위치별 수량 칸은 [쉽먼트] 모달과 같은 스타일 (/storage/wow 로 바로 들어와도 적용되게)
import '../stock/Stock.css';

// ============================================================
// WowPickModal — 와우출고 [작업완료] 확인 창: 와우 박스(발주번호-박스번호) 하나 = 빈 X 박스 하나
//
//   표에서 위치를 보고 상품을 다 찾은 뒤 여는 창 — 어느 박스에 담았는지와 실제 담은 수량을 확정한다
//   줄마다 위치별 꺼낸 수량 (기본 = 표의 [위치] 칸과 같은 계산: 요청 수량을 먼저 배치된 위치부터)
//   요청보다 적게 담으면 확인 — 담은 수량으로 확정되고 나머지 예약은 풀린다
//     (상품이 실제로 없으면 [재고] 수량을 고쳐야 다음 배정이 다시 잡지 않는다)
//   저장: POST /api/ft/storage/wow { action: 'pick' } → ft_wow_pick (한 트랜잭션, 타입 DIRECT)
//     → 재고에서 빠지고 박스가 [작업완료] 단계로 넘어간다
// ============================================================

interface WowPickModalProps {
  /** 한 와우 박스의 줄 */
  lines: WowLine[];
  onClose: (changed: boolean) => void;
}

const cellKey = (itemId: string, locationId: string) => `${itemId}|${locationId}`;

const WowPickModal: React.FC<WowPickModalProps> = ({ lines, onClose }) => {
  const { t } = useTranslation();
  const { stock, worker, reloadAll } = useStorage();
  const head = lines[0];

  // ── 줄마다 그 상품이 있는 위치 (먼저 배치된 순) ──
  const cellsOf = useMemo(() => {
    const map = new Map<string, StockRow[]>();
    for (const l of lines) map.set(l.item_id, stockCellsOf(stock.rows, l.product_id));
    return map;
  }, [lines, stock.rows]);

  const [qtyText, setQtyText] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of lines) {
      for (const { cell, take } of planPicks(l.qty, cellsOf.get(l.item_id) ?? []).plan) {
        init[cellKey(l.item_id, cell.location_id)] = String(take);
      }
    }
    return init;
  });
  const [box, setBox] = useState<BoxInfoItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ============================================================
  // 검증 (최종 판정은 서버)
  // ============================================================
  const qtyOf = (itemId: string, c: StockRow) => Number(qtyText[cellKey(itemId, c.location_id)] ?? '');
  const cellValid = (itemId: string, c: StockRow) => {
    const q = qtyOf(itemId, c);
    return Number.isInteger(q) && q >= 0 && q <= c.qty;
  };
  const lineTotal = (l: WowLine) => (cellsOf.get(l.item_id) ?? []).reduce((s, c) => s + (qtyOf(l.item_id, c) || 0), 0);
  const allValid = lines.every((l) => (cellsOf.get(l.item_id) ?? []).every((c) => cellValid(l.item_id, c)) && lineTotal(l) <= l.qty)
    && lines.some((l) => lineTotal(l) > 0);

  // ============================================================
  // 저장
  // ============================================================
  const handleSubmit = async () => {
    if (saving || !box || !worker || !allValid) return;
    const short = lines.filter((l) => lineTotal(l) < l.qty).length;
    if (short > 0 && !window.confirm(t('storage.wow.shortConfirm', { count: short }))) return;

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/ft/storage/wow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pick',
          user_id: head.user_id,
          wow_box_id: head.box_id,
          box_info_id: box.id,
          operator_name: worker,
          lines: lines.map((l) => ({
            item_id: l.item_id,
            picks: (cellsOf.get(l.item_id) ?? [])
              .map((c): PickInput => ({ location_id: c.location_id, qty: qtyOf(l.item_id, c) }))
              .filter((p) => p.qty > 0),
          })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        playErrorSound();
        setError(json.error || t('storage.wow.error'));
        return;
      }
      reloadAll();
      onClose(true);
    } catch (err) {
      console.error('와우출고 작업완료 오류:', err);
      playErrorSound();
      setError(t('storage.wow.error'));
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal storage-modal--wide" role="dialog" aria-label={t('storage.wow.completeTitle')}>
        <div className="storage-modal-head">
          <h3>{t('storage.wow.completeTitle')} · {head.order_number}-{head.box_no}</h3>
          <button type="button" className="storage-modal-x" onClick={() => onClose(false)} disabled={saving}>✕</button>
        </div>

        <div className="storage-pick-groups">
          {lines.map((l) => {
            const cells = cellsOf.get(l.item_id) ?? [];
            const total = lineTotal(l);
            return (
              <div key={l.item_id} className="storage-pick-group">
                <ProductCell info={l} />
                <div className="storage-pick-type">
                  <span className="storage-pick-type-label">{t('storage.wow.requested')}</span>
                  <strong>{l.qty}</strong>
                  <span className="storage-pick-type-label">{t('storage.wow.picked')}</span>
                  <strong className={total < l.qty ? 'storage-wow-short' : ''}>{total}</strong>
                </div>
                <div className="storage-pick-cells">
                  {cells.length === 0 && <span className="storage-hint">{t('storage.stock.empty')}</span>}
                  {cells.map((c) => (
                    <label key={c.location_id} className="storage-pick-cell">
                      <span className="storage-location-code">{c.location_code}</span>
                      <input
                        type="number"
                        className={`storage-input storage-input--qty ${cellValid(l.item_id, c) ? '' : 'is-invalid'}`}
                        min={0}
                        max={c.qty}
                        value={qtyText[cellKey(l.item_id, c.location_id)] ?? ''}
                        onChange={(e) => setQtyText((prev) => ({ ...prev, [cellKey(l.item_id, c.location_id)]: e.target.value }))}
                        disabled={saving}
                      />
                      <span className="storage-hint">/ {c.qty}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <BoxField userId={head.user_id} type="X" value={box} onChange={setBox} disabled={saving}>
          <span className="storage-hint">{t('storage.wow.boxHint')}</span>
        </BoxField>

        {error && <div className="storage-message is-error">{error}</div>}
        {!worker && <div className="storage-message is-error">{t('storage.needWorker')}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => onClose(false)} disabled={saving}>
            {t('storage.close')}
          </button>
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            onClick={handleSubmit}
            disabled={saving || !box || !worker || !allValid}
          >
            {saving ? t('storage.saving') : t('storage.wow.complete')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WowPickModal;
