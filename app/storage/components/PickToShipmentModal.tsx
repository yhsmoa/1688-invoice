'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BoxCreateModal, { type CreatedBox } from '../../../component/BoxCreateModal';
import { resolveScanSizeCode } from '../../../lib/sizeCode';
import type { BoxInfoItem } from '../../shipment-v2/types';
import { useStorage } from '../hooks/StorageContext';
import type { PickInput, PickTypeInput, StockRow, StorageRequest, StorageShipmentType } from '../types';
import ProductCell from './ProductCell';
import { formatDateTime, playErrorSound } from '../utils/storageFormat';

// ============================================================
// PickToShipmentModal — 재고 → 쉽먼트
//
//   체크한 칸(상품 × 위치)을 상품별로 묶어, 위치별 꺼낼 수량을 받는다 (기본 = 칸 전량)
//   타입: S 상품은 꺼낼 때 정한다 (supabase/storage/003_stock_type.sql)
//     · 미처리 고객 요청이 있으면 그 타입·수량을 기본값으로 (요청 카드 표시)
//     · 상품에 이미 타입이 있으면 고정 표시 (미출고 박스가 있는 동안 서버가 변경을 막는다)
//     · 없으면 COUPANG / PERSONAL / DIRECT 선택 — COUPANG 은 사이즈(보존값 기본), PERSONAL 은 개인 주문번호
//   박스: 그 사용자의 열린 박스(PACKING & 미출고) 중 하나 / [+ 새 박스] → BoxCreateModal
//   저장: 상품마다 POST /api/ft/storage/pick 1회 (상품마다 독립 트랜잭션)
//     → 타입 기록 + PICK 원장 + PACKED 행 — 이후 쉽먼트 V2 에서 일반 포장 행과 똑같이 보인다
//   박스 타입 ≠ 상품 타입: 서버가 PICK_BOX_TYPE_MISMATCH 로 거절
//     → [타입이 달라도 담기] 체크 후 다시 저장 (상품출고 V2 의 A=B=C=P=X 와 같은 의미)
//   결과는 상품별 ✅/❌ 로 모달 안에 보여주고, 하나라도 성공하면 목록 재조회
// ============================================================

interface PickToShipmentModalProps {
  rows: StockRow[];
  requests: StorageRequest[];
  onClose: (changed: boolean) => void;
}

interface ProductGroup {
  productId: string;
  rep: StockRow;
  cells: StockRow[];
  request: StorageRequest | null;
  /** 상품에 이미 타입이 있으면 true — 선택 UI 대신 고정 표시 */
  typeFixed: boolean;
}

type ResultMap = Record<string, { ok: boolean; text: string }>;

const SHIPMENT_TYPES: StorageShipmentType[] = ['COUPANG', 'PERSONAL', 'DIRECT'];
const SIZES = ['Small', 'Medium', 'Large'];

const PickToShipmentModal: React.FC<PickToShipmentModalProps> = ({ rows, requests, onClose }) => {
  const { t } = useTranslation();
  const { userId, userCode, worker, reloadAll } = useStorage();

  // ── 상품별 묶음 (화면 순서 유지) + 미처리 요청 ──
  const groups = useMemo<ProductGroup[]>(() => {
    const map = new Map<string, ProductGroup>();
    for (const r of rows) {
      const g = map.get(r.product_id) ?? {
        productId: r.product_id,
        rep: r,
        cells: [],
        request: requests.find((q) => q.product_id === r.product_id && q.status === 'REQUESTED') ?? null,
        typeFixed: !!r.shipment_type,
      };
      g.cells.push(r);
      map.set(r.product_id, g);
    }
    return Array.from(map.values());
  }, [rows, requests]);

  // ============================================================
  // 상태
  // ============================================================
  const cellKey = (r: StockRow) => `${r.product_id}|${r.location_id}`;

  // 수량 기본값: 요청이 있으면 요청 수량을 위치 순서대로 배분, 없으면 칸 전량
  const [qtyText, setQtyText] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of groups) {
      let left = g.request?.qty ?? Infinity;
      for (const c of g.cells) {
        const q = Math.max(0, Math.min(c.qty, left));
        init[cellKey(c)] = String(q);
        left -= q;
      }
    }
    return init;
  });

  // 타입 입력: 요청 → 보존값 순으로 기본값
  const [typeInput, setTypeInput] = useState<Record<string, PickTypeInput>>(() =>
    Object.fromEntries(groups.map((g) => [g.productId, {
      shipment_type: (g.request?.shipment_type ?? (g.rep.shipment_type as StorageShipmentType | null)) ?? null,
      coupang_shipment_size: g.request?.coupang_shipment_size ?? g.rep.coupang_shipment_size ?? null,
      personal_order_no: g.request?.personal_order_no ?? g.rep.personal_order_no ?? null,
    }]))
  );
  const setType = (pid: string, patch: Partial<PickTypeInput>) =>
    setTypeInput((prev) => ({ ...prev, [pid]: { ...prev[pid], ...patch } }));

  const [boxes, setBoxes] = useState<BoxInfoItem[]>([]);
  const [boxesLoading, setBoxesLoading] = useState(true);
  const [boxId, setBoxId] = useState('');
  const [force, setForce] = useState(false);
  const [showBoxCreate, setShowBoxCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<ResultMap>({});
  const [changed, setChanged] = useState(false);

  // ── 열린 박스 목록 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBoxesLoading(true);
      try {
        const res = await fetch(`/api/ft/box-info?user_id=${encodeURIComponent(userId)}&status=PACKING&shipment_id=null`);
        const json = await res.json();
        if (cancelled) return;
        const list = ((json.success ? json.data : []) as BoxInfoItem[])
          .slice()
          .sort((a, b) => (a.box_code || '').localeCompare(b.box_code || ''));
        setBoxes(list);
      } catch (err) {
        if (!cancelled) console.error('박스 목록 조회 오류:', err);
      } finally {
        if (!cancelled) setBoxesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleBoxCreated = (created: CreatedBox) => {
    const item: BoxInfoItem = { id: created.id, box_code: created.box_code, size: created.size, type: created.type, no: created.no };
    setBoxes((prev) => [...prev.filter((b) => b.id !== item.id), item].sort((a, b) => a.box_code.localeCompare(b.box_code)));
    setBoxId(created.id);
    setShowBoxCreate(false);
  };

  const box = boxes.find((b) => b.id === boxId);

  // ============================================================
  // 검증 (최종 판정은 서버)
  // ============================================================
  const qtyOf = (r: StockRow) => Number(qtyText[cellKey(r)] ?? '');
  const cellValid = (r: StockRow) => {
    const q = qtyOf(r);
    return Number.isInteger(q) && q >= 0 && q <= r.qty;
  };
  const typeValid = (g: ProductGroup) => {
    const ti = typeInput[g.productId];
    if (!ti?.shipment_type) return false;
    if (ti.shipment_type === 'COUPANG' && !ti.coupang_shipment_size) return false;
    if (ti.shipment_type === 'PERSONAL' && !ti.personal_order_no?.trim()) return false;
    return true;
  };
  const allValid =
    rows.every(cellValid) && rows.some((r) => qtyOf(r) > 0) && groups.every((g) => results[g.productId]?.ok || typeValid(g));

  // 타입 미리보기 (박스 불일치 경고용)
  const codeOf = (g: ProductGroup) => {
    const ti = typeInput[g.productId];
    return ti?.shipment_type ? resolveScanSizeCode(ti.shipment_type, ti.coupang_shipment_size) : null;
  };
  const mismatched = box ? groups.filter((g) => codeOf(g) !== null && codeOf(g) !== box.type) : [];

  // ============================================================
  // 저장 — 상품마다 1회, 이미 성공한 상품은 다시 보내지 않는다
  // ============================================================
  const handleSubmit = async () => {
    if (saving || !box || !worker || !allValid) return;
    setSaving(true);
    const next: ResultMap = { ...results };
    let anyOk = false;
    for (const g of groups) {
      if (next[g.productId]?.ok) continue;
      const picks: PickInput[] = g.cells
        .map((c) => ({ location_id: c.location_id, qty: qtyOf(c) }))
        .filter((p) => p.qty > 0);
      if (picks.length === 0) continue;
      const ti = typeInput[g.productId];
      try {
        const res = await fetch('/api/ft/storage/pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            product_id: g.productId,
            order_item_id: g.rep.order_item_id,
            picks,
            box_info_id: box.id,
            operator_name: worker,
            force,
            shipment_type: ti.shipment_type,
            coupang_shipment_size: ti.shipment_type === 'COUPANG' ? ti.coupang_shipment_size : null,
            personal_order_no: ti.shipment_type === 'PERSONAL' ? ti.personal_order_no?.trim() : null,
          }),
        });
        const json = await res.json();
        if (json.success) {
          anyOk = true;
          next[g.productId] = { ok: true, text: t('storage.pick.done', { box: json.box_code, qty: json.picked }) };
        } else {
          const hint = json.code === 'PICK_BOX_TYPE_MISMATCH' ? ` ${t('storage.pick.forceHint')}` : '';
          next[g.productId] = { ok: false, text: (json.error || t('storage.pick.error')) + hint };
        }
      } catch (err) {
        console.error('재고 쉽먼트 오류:', err);
        next[g.productId] = { ok: false, text: t('storage.pick.error') };
      }
    }
    setResults(next);
    setSaving(false);
    if (anyOk) {
      setChanged(true);
      reloadAll();
    }
    if (Object.values(next).some((r) => !r.ok)) playErrorSound();
    else if (groups.every((g) => next[g.productId]?.ok)) onClose(true);
  };

  const allDone = groups.every((g) => results[g.productId]?.ok);

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal storage-modal--wide" role="dialog" aria-label={t('storage.pick.title')}>
        <div className="storage-modal-head">
          <h3>{t('storage.pick.title')}</h3>
          <button type="button" className="storage-modal-x" onClick={() => onClose(changed)} disabled={saving}>✕</button>
        </div>

        {/* ── 상품별 타입 · 위치 · 수량 ── */}
        <div className="storage-pick-groups">
          {groups.map((g) => {
            const result = results[g.productId];
            const ti = typeInput[g.productId];
            const locked = saving || !!result?.ok;
            return (
              <div key={g.productId} className={`storage-pick-group ${result ? (result.ok ? 'is-ok' : 'is-fail') : ''}`}>
                <ProductCell info={g.rep} />

                {/* 고객 요청 */}
                {g.request && (
                  <div className="storage-request-card">
                    <strong>{t('storage.request.label')}</strong>{' '}
                    {t('storage.request.summary', {
                      qty: g.request.qty,
                      type: g.request.shipment_type,
                      detail: g.request.coupang_shipment_size || g.request.personal_order_no || '',
                      at: formatDateTime(g.request.requested_at),
                    })}
                  </div>
                )}

                {/* 타입 — 꺼낼 때 정한다 */}
                <div className="storage-pick-type">
                  <span className="storage-pick-type-label">{t('storage.pick.type')}</span>
                  {g.typeFixed ? (
                    <span className="storage-pick-type-fixed" title={t('storage.pick.typeFixedHint')}>
                      {g.rep.shipment_type}{g.rep.coupang_shipment_size ? ` · ${g.rep.coupang_shipment_size}` : ''}
                      {g.rep.personal_order_no ? ` · ${g.rep.personal_order_no}` : ''}
                    </span>
                  ) : (
                    <>
                      {SHIPMENT_TYPES.map((st) => (
                        <label key={st} className={`storage-pick-type-opt ${ti.shipment_type === st ? 'is-on' : ''}`}>
                          <input
                            type="radio"
                            name={`type-${g.productId}`}
                            checked={ti.shipment_type === st}
                            onChange={() => setType(g.productId, { shipment_type: st })}
                            disabled={locked}
                          />
                          {st}
                        </label>
                      ))}
                      {ti.shipment_type === 'COUPANG' && (
                        <select
                          className="storage-select"
                          value={ti.coupang_shipment_size ?? ''}
                          onChange={(e) => setType(g.productId, { coupang_shipment_size: e.target.value || null })}
                          disabled={locked}
                        >
                          <option value="">{t('storage.pick.sizePlaceholder')}</option>
                          {SIZES.map((sz) => <option key={sz} value={sz}>{sz}</option>)}
                        </select>
                      )}
                      {ti.shipment_type === 'PERSONAL' && (
                        <input
                          className="storage-input"
                          value={ti.personal_order_no ?? ''}
                          placeholder={t('storage.pick.personalNoPlaceholder')}
                          onChange={(e) => setType(g.productId, { personal_order_no: e.target.value })}
                          disabled={locked}
                        />
                      )}
                    </>
                  )}
                </div>

                <div className="storage-pick-cells">
                  {g.cells.map((c) => (
                    <label key={c.location_id} className="storage-pick-cell">
                      <span className="storage-location-code">{c.location_code}</span>
                      <input
                        type="number"
                        className={`storage-input storage-input--qty ${cellValid(c) ? '' : 'is-invalid'}`}
                        min={0}
                        max={c.qty}
                        value={qtyText[cellKey(c)] ?? ''}
                        onChange={(e) => setQtyText((prev) => ({ ...prev, [cellKey(c)]: e.target.value }))}
                        disabled={locked}
                      />
                      <span className="storage-hint">/ {c.qty}</span>
                    </label>
                  ))}
                </div>
                {result && <div className={`storage-message is-${result.ok ? 'ok' : 'error'}`}>{result.ok ? '✅' : '❌'} {result.text}</div>}
              </div>
            );
          })}
        </div>

        {/* ── 박스 ── */}
        <div className="storage-modal-field">
          <div className="storage-field-head">
            <label>{t('storage.pick.box')}</label>
            <button
              type="button"
              className="storage-link-btn"
              onClick={() => setShowBoxCreate(true)}
              disabled={boxesLoading || saving || !userCode}
            >
              {t('storage.pick.newBox')}
            </button>
          </div>
          {boxesLoading ? (
            <span className="storage-hint">{t('storage.loading')}</span>
          ) : boxes.length === 0 ? (
            <span className="storage-hint">{t('storage.pick.noBoxes')}</span>
          ) : (
            <select className="storage-select" value={boxId} onChange={(e) => setBoxId(e.target.value)} disabled={saving}>
              <option value="">{t('storage.pick.selectBox')}</option>
              {boxes.map((b) => (
                <option key={b.id} value={b.id}>{b.box_code}{b.size ? ` (${b.size})` : ''}</option>
              ))}
            </select>
          )}
          {mismatched.length > 0 && (
            <div className="storage-message is-warn">
              {t('storage.pick.mismatch', { box: box?.type ?? '-', count: mismatched.length })}
            </div>
          )}
          <label className="storage-check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={saving} />
            {t('storage.pick.force')}
          </label>
        </div>

        {!worker && <div className="storage-message is-error">{t('storage.needWorker')}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => onClose(changed)} disabled={saving}>
            {t('storage.close')}
          </button>
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            onClick={handleSubmit}
            disabled={saving || allDone || !box || !worker || !allValid}
          >
            {saving ? t('storage.saving') : t('storage.pick.confirm')}
          </button>
        </div>

        {showBoxCreate && (
          <BoxCreateModal
            userId={userId}
            userCode={userCode}
            existingBoxes={boxes}
            onClose={() => setShowBoxCreate(false)}
            onCreated={handleBoxCreated}
          />
        )}
      </div>
    </div>
  );
};

export default PickToShipmentModal;
