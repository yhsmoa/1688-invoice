'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStorage } from '../hooks/StorageContext';
import { useLocationSuggest } from '../hooks/useLocationSuggest';
import ProductCell from './ProductCell';
import { formatDateTime, playErrorSound } from '../utils/storageFormat';

// ============================================================
// PutawayModal — 위치 배치 (작업중 → 재고)
//
//   흐름 (바코드 리더 기준):
//     위치 입력창(자동 포커스)에 위치 스캔 → Enter → 수량 입력창(기본값 = 미배치 전량)
//     → Enter 또는 [저장] → POST /api/ft/storage/putaway
//     · 저장 후 미배치가 남으면 모달 유지 (같은 상품을 다른 위치에 나눠 보관)
//     · 다 배치되면 닫힘 → 부모가 스캔창으로 포커스
//
//   수량은 상품 단위 (세트 = 1세트). 미배치는 오래된 입고 줄부터 FIFO 로 줄어들므로
//   기록용 inbound_id 는 미배치가 남은 가장 오래된 줄을 보낸다.
//   줄 목록·미배치는 StorageContext 의 작업중 목록에서 다시 계산 → 저장 후 재조회로 갱신
// ============================================================

interface PutawayModalProps {
  productId: string;
  onClose: (allPlaced: boolean) => void;
}

const PutawayModal: React.FC<PutawayModalProps> = ({ productId, onClose }) => {
  const { t } = useTranslation();
  const { userId, worker, pending, reloadAll } = useStorage();
  const { suggestions, reload: reloadSuggest } = useLocationSuggest(userId, productId);

  // ── 이 상품의 입고 줄 (오래된 순 — API 가 정렬해서 준다) ──
  const lines = useMemo(
    () => pending.rows.filter((r) => r.product_id === productId),
    [pending.rows, productId]
  );
  const totalUnplaced = lines.reduce((s, l) => s + l.line_unplaced, 0);
  const head = lines[0];

  const [location, setLocation] = useState('');
  const [qtyText, setQtyText] = useState(String(totalUnplaced));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const locRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // ── 재조회로 미배치가 바뀌면 수량 기본값을 맞춘다 ──
  useEffect(() => { setQtyText(String(totalUnplaced)); }, [totalUnplaced]);

  // ── 저장 중이 아닌데 줄이 없어졌다 = 다 배치됨 (다른 PC 에서 처리한 경우 포함) ──
  useEffect(() => {
    if (!saving && !pending.loading && lines.length === 0) onClose(true);
  }, [saving, pending.loading, lines.length, onClose]);

  const qty = Number(qtyText);
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= totalUnplaced;

  // ============================================================
  // 저장
  // ============================================================
  const handleSave = async () => {
    if (saving || !head) return;
    if (!worker) { setMessage({ kind: 'error', text: t('storage.needWorker') }); return; }
    if (!location.trim()) { locRef.current?.focus(); return; }
    if (!qtyValid) {
      setMessage({ kind: 'error', text: t('storage.putaway.invalidQty', { max: totalUnplaced }) });
      qtyRef.current?.select();
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/ft/storage/putaway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          product_id: productId,
          inbound_id: head.inbound_id,
          location_code: location,
          qty,
          operator_name: worker,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        playErrorSound();
        setMessage({ kind: 'error', text: json.error || t('storage.putaway.error') });
        return;
      }
      setMessage({
        kind: 'ok',
        text: t('storage.putaway.saved', { location: json.location_code, qty, remaining: json.remaining }),
      });
      setLocation('');
      reloadAll();
      reloadSuggest();
      if (json.remaining > 0) locRef.current?.focus();
    } catch (err) {
      console.error('위치 배치 오류:', err);
      playErrorSound();
      setMessage({ kind: 'error', text: t('storage.putaway.error') });
    } finally {
      setSaving(false);
    }
  };

  if (!head) return null;

  // ============================================================
  // 렌더
  // ============================================================
  return (
    // 바깥 클릭으로는 닫지 않는다 — 스캔 중 실수로 닫히면 입력이 사라진다
    <div className="storage-modal-overlay">
      <div className="storage-modal" role="dialog" aria-label={t('storage.putaway.title')}>
        <div className="storage-modal-head">
          <h3>{t('storage.putaway.title')}</h3>
          <button type="button" className="storage-modal-x" onClick={() => onClose(false)} disabled={saving}>✕</button>
        </div>

        <ProductCell info={head} large />

        {/* ── 입고 줄 · 미배치 ── */}
        <div className="storage-putaway-lines">
          {lines.map((l) => (
            <span key={l.inbound_id} className="storage-line-chip">
              {formatDateTime(l.arrived_at)} · {t('storage.putaway.lineQty', { qty: l.line_qty, unplaced: l.line_unplaced })}
            </span>
          ))}
          <strong className="storage-putaway-total">{t('storage.putaway.total', { qty: totalUnplaced })}</strong>
        </div>

        {/* ── 추천 위치 ── */}
        <div className="storage-modal-field">
          <label>{t('storage.putaway.suggest')}</label>
          {suggestions.length === 0 ? (
            <span className="storage-hint">{t('storage.putaway.noSuggest')}</span>
          ) : (
            <div className="storage-suggest">
              {suggestions.map((s) => (
                <button
                  key={s.location_id}
                  type="button"
                  className={`storage-suggest-chip is-${s.reason}`}
                  onClick={() => { setLocation(s.location_code); qtyRef.current?.select(); }}
                  title={t(`storage.putaway.reason.${s.reason}`)}
                >
                  {s.location_code} ({s.qty})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 위치 · 수량 ── */}
        <div className="storage-modal-row">
          <div className="storage-modal-field">
            <label>{t('storage.putaway.location')}</label>
            <input
              ref={locRef}
              className="storage-input storage-input--location"
              value={location}
              autoFocus
              placeholder={t('storage.putaway.locationPlaceholder')}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (location.trim()) qtyRef.current?.select();
              }}
              disabled={saving}
            />
          </div>
          <div className="storage-modal-field">
            <label>{t('storage.putaway.qty')}</label>
            <input
              ref={qtyRef}
              type="number"
              className="storage-input storage-input--qty"
              min={1}
              max={totalUnplaced}
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
              disabled={saving}
            />
          </div>
        </div>

        {message && <div className={`storage-message is-${message.kind}`}>{message.text}</div>}
        {!worker && <div className="storage-message is-error">{t('storage.needWorker')}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => onClose(false)} disabled={saving}>
            {t('storage.close')}
          </button>
          <button
            type="button"
            className="storage-btn storage-btn--primary"
            onClick={handleSave}
            disabled={saving || !worker || !location.trim() || !qtyValid}
          >
            {saving ? t('storage.saving') : t('storage.putaway.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PutawayModal;
