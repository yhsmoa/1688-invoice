'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocationSuggest } from '../../../storage/hooks/useLocationSuggest';
import { joinOptions, playErrorSound } from '../../../storage/utils/storageFormat';
import { playOkSound } from '../../utils/sound';
import type { PendingProduct, ScanRequest } from '../types';
import { isOwnLabel } from '../utils/pendingProducts';
import { postPutaway } from '../utils/putawayApi';
import ProductThumb from './ProductThumb';
import NumPadSheet from '../../components/NumPadSheet';

// ============================================================
// PlaceScreen — 배치 화면 (상품 하나를 위치에 넣는다)
//   PC 의 배치 창(app/storage/components/PutawayModal.tsx)과 같은 일을 한다
//
//   상품(+ 미배치 수량 동그라미) → 추천 위치(있을 때만, 누르면 위치 칸에 들어간다)
//   → 위치(카메라 · 직접 입력) → 수량(처음 값 = 미배치 전부, 1 ~ 미배치) → 아래 [배치]
//
//   · 폰 화면이 작아 상품명은 빼고 번호 · 옵션 · 바코드만 보여 준다
//   · 수량은 폰 키보드 대신 숫자패드 창(NumPadSheet)으로 입력한다
//   · 화면 높이에 맞춘 틀 — 가운데만 넘기고 [배치] 는 늘 맨 아래 (Putaway.css 배치 화면 틀)
//
//   · 위치는 처음 쓰는 값이어도 서버가 새 위치로 등록한다 (PC 와 같다). 그래서 카메라로 읽은 값은
//     위치 칸에 넣기만 하고, 저장은 작업자가 [배치] 버튼의 위치 · 수량을 보고 누른다
//   · 이 상품 자신의 라벨(주문번호 라벨 · 상품 바코드)은 위치로 받지 않는다
//   · 저장되면: 미배치가 남았으면 이 화면에 그대로 (나머지를 다른 위치에) · 다 넣었으면 목록으로
//   · 서버가 거절하면 서버 문구 + 경고음. 목록을 새로 받아 미배치 수량을 다시 맞춘다
//   · 연결이 끊겨 저장 여부를 모르면 다시 보내지 않는다 (두 번 배치될 수 있다).
//     목록을 새로 받아 미배치가 보낸 수량만큼 줄었으면 저장된 것으로 본다
//   · 저장 · 새로고침은 한 번에 하나만
// ============================================================

interface PlaceScreenProps {
  product: PendingProduct;
  operatorName: string;
  /** 여러 사업자의 상품이 섞여 있을 때만 — 이 상품의 사업자 */
  userCode: string | null;
  /** 방금 배치함 — 목록의 남은 미배치를 바로 맞춘다 */
  onPlaced: (remaining: number) => void;
  /** 목록을 새로 받는다 — 실패하면 null (안내는 이 화면이 한다) */
  onReload: () => Promise<PendingProduct[] | null>;
  /** 목록으로 — message 가 있으면 목록에서 안내로 띄운다 */
  onExit: (message?: string) => void;
  /** 카메라로 읽어 달라고 한다 */
  onScan: (request: ScanRequest) => void;
  notify: (text: string) => void;
}

type Busy = 'save' | 'refresh' | null;

const PlaceScreen: React.FC<PlaceScreenProps> = ({
  product, operatorName, userCode, onPlaced, onReload, onExit, onScan, notify,
}) => {
  const { t } = useTranslation();
  const { head } = product;
  /** 넣을 수 있는 가장 큰 수량 = 미배치 */
  const max = product.unplaced;
  const { suggestions, reload: reloadSuggest } = useLocationSuggest(product.user_id, product.product_id);

  const [location, setLocation] = useState('');
  const [qty, setQty] = useState(max);
  const [numPadOpen, setNumPadOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const lockRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── 미배치가 바뀌면(배치 후 · 새로고침) 수량의 처음 값을 다시 맞춘다 ──
  useEffect(() => { setQty(max); }, [max]);

  /** 서버가 위치를 대문자 · 앞뒤 공백 없이 등록하므로 화면도 같은 값으로 보여 준다 */
  const locationCode = location.trim().toUpperCase();
  const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= max;

  const isHere = useCallback(
    (list: PendingProduct[]) => list.some((p) => p.product_id === product.product_id),
    [product.product_id]
  );

  // ============================================================
  // 한 번에 하나만 — 저장 · 새로고침이 겹치지 않게
  // ============================================================
  const run = useCallback(async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(kind);
    try {
      await fn();
    } finally {
      lockRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }, []);

  // ============================================================
  // 배치
  // ============================================================

  // ── 저장된 뒤: 다 넣었으면 목록으로, 남았으면 이 화면에서 다음 위치를 받는다 ──
  //   listIsFresh = 방금 목록을 새로 받았다 (다시 받지 않는다)
  const finishSaved = useCallback(async (code: string, placedQty: number, remaining: number, listIsFresh: boolean) => {
    playOkSound();
    onPlaced(remaining);
    if (remaining <= 0) {
      onExit(t('mobile.putaway.place.doneAll', { location: code, qty: placedQty }));
      return;
    }
    notify(t('storage.putaway.saved', { location: code, qty: placedQty, remaining }));
    setLocation('');
    reloadSuggest();
    if (listIsFresh) return;
    // 다음 배치에 보낼 입고 줄까지 맞추려고 목록을 새로 받는다 (실패해도 남은 수량은 이미 맞다)
    const list = await onReload();
    if (list && !isHere(list)) onExit();
  }, [onPlaced, onExit, onReload, notify, reloadSuggest, isHere, t]);

  const handleSave = useCallback(() => {
    if (lockRef.current) return;
    if (!locationCode) {
      playErrorSound();
      notify(t('mobile.putaway.place.needLocation'));
      return;
    }
    if (!qtyValid) {
      playErrorSound();
      notify(t('storage.putaway.invalidQty', { max }));
      return;
    }

    const before = max;
    run('save', async () => {
      const result = await postPutaway({
        user_id: product.user_id,
        product_id: product.product_id,
        inbound_id: head.inbound_id,
        location_code: locationCode,
        qty,
        operator_name: operatorName,
      });
      if (result.kind === 'saved') {
        await finishSaved(result.locationCode, qty, result.remaining ?? before - qty, false);
        return;
      }

      // 거절 · 저장 여부 모름 → 목록을 새로 받아 지금 미배치를 확인한다 (after = null 이면 확인하지 못함)
      const list = await onReload();
      const after = list ? (list.find((p) => p.product_id === product.product_id)?.unplaced ?? 0) : null;
      if (result.kind === 'unsure' && after !== null && before - after === qty) {
        await finishSaved(locationCode, qty, after, true);
        return;
      }

      playErrorSound();
      const text =
        result.kind === 'rejected' ? (result.message || t('storage.putaway.error'))
        : after === before ? (result.message || t('mobile.wow.error.network'))
        : t('mobile.putaway.place.unsure');
      // 그 사이 다른 사람이 다 배치했으면 이 화면에서 더 할 일이 없다
      if (after === 0) onExit(text);
      else notify(text);
    });
  }, [locationCode, qtyValid, qty, max, product, head.inbound_id, operatorName, run, finishSaved, onReload, onExit, notify, t]);

  // ============================================================
  // 새로고침 (미배치 수량 · 추천 위치)
  // ============================================================
  const handleRefresh = useCallback(() => run('refresh', async () => {
    reloadSuggest();
    const list = await onReload();
    if (!list) {
      playErrorSound();
      notify(t('storage.loadError'));
      return;
    }
    if (!isHere(list)) onExit(t('storage.scan.alreadyPlaced', { code: head.product_no ?? '' }));
  }), [run, reloadSuggest, onReload, onExit, notify, isHere, head.product_no, t]);

  // ============================================================
  // 위치 · 수량 입력
  // ============================================================

  // ── 카메라로 위치 라벨 읽기 — 읽은 값은 위치 칸에 넣기만 한다 ──
  const handleScanLocation = useCallback(() => {
    onScan({
      hint: t('mobile.putaway.place.camHint'),
      notMatched: t('mobile.putaway.place.camNotMatched'),
      onCode: (text) => {
        if (isOwnLabel(product, text)) return false;
        setLocation(text.trim().toUpperCase());
        playOkSound();
        return true;
      },
    });
  }, [onScan, product, t]);

  // ── [−] [+] — 1 ~ 미배치 사이에서만 움직인다 ──
  const stepQty = (delta: number) => setQty((q) => Math.min(max, Math.max(1, q + delta)));

  // ============================================================
  // 화면
  // ============================================================
  const saving = busy === 'save';
  const isSet = (head.set_total ?? 0) > 1;
  const optionKo = joinOptions(head.option_name);
  const optionCn = joinOptions(head.china_option1, head.china_option2);
  const suggestReason = suggestions[0]?.reason;
  const submitLabel =
    saving ? t('storage.saving')
    : locationCode && qtyValid ? t('mobile.putaway.place.submit', { location: locationCode, qty })
    : t('storage.pending.place');

  return (
    <div className="mob-page mput-place">
      {/* 머리 */}
      <header className="mob-head">
        <button type="button" className="mob-back mput-head-btn" disabled={saving} onClick={() => onExit()}>
          ‹ {t('mobile.wow.deck.toList')}
        </button>
        <div className="mob-head-title">{t('storage.putaway.title')}</div>
        <div className="mob-head-right">
          <button
            type="button"
            className="mob-back mput-head-btn"
            disabled={busy !== null}
            onClick={handleRefresh}
            aria-label={t('storage.refresh')}
            title={t('storage.refresh')}
          >
            ↻
          </button>
        </div>
      </header>

      <main className="mob-body">
        {/* 상품 */}
        <section className="mob-card mput-product">
          {/* 사진 왼쪽 위 모서리의 동그라미 = 미배치 수량 */}
          <span className="mput-thumb-wrap">
            <ProductThumb url={head.img_url} large />
            <span className="mput-unplaced-badge" aria-label={`${t('storage.col.unplaced')} ${max}`}>
              <small aria-hidden="true">{t('storage.col.unplaced')}</small>
              <b aria-hidden="true">{max}</b>
            </span>
          </span>
          <div className="mput-product-text">
            <div className="mput-product-no">
              {head.product_no ?? '-'}
              {userCode && <span className="mob-chip">{userCode}</span>}
              {isSet && <span className="mob-chip">SET {head.set_total}</span>}
            </div>
            {optionKo && <div className="mput-product-opt">{optionKo}</div>}
            {optionCn && <div className="mput-product-opt">{optionCn}</div>}
            {head.barcode && <div className="mput-product-code">{head.barcode}</div>}
          </div>
        </section>

        {/* 추천 위치 — 있을 때만 */}
        {suggestions.length > 0 && (
          <div className="mob-field">
            <span>
              {t('storage.putaway.suggest')}
              {suggestReason && ` · ${t(`storage.putaway.reason.${suggestReason}`)}`}
            </span>
            <div className="mput-chips">
              {suggestions.map((s) => (
                <button
                  key={s.location_id}
                  type="button"
                  className={`mput-chip${s.location_code === locationCode ? ' is-on' : ''}`}
                  disabled={saving}
                  onClick={() => setLocation(s.location_code)}
                >
                  {s.location_code}
                  <small>{s.qty}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 위치 */}
        <div className="mob-field">
          <span>{t('storage.col.location')}</span>
          <div className="mob-scanrow">
            <input
              className="mob-input mob-code-input mput-loc-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="done"
              value={location}
              disabled={saving}
              placeholder={t('mobile.putaway.place.locationPlaceholder')}
              aria-label={t('storage.col.location')}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
            />
            <button
              type="button"
              className="mob-cam-btn"
              disabled={saving}
              onClick={handleScanLocation}
              aria-label={t('mobile.putaway.place.camera')}
            >
              <span aria-hidden="true">📷</span>
            </button>
          </div>
        </div>

        {/* 수량 */}
        <div className="mob-field">
          <span className="mput-qty-head">
            {t('storage.putaway.qty')}
            <button type="button" className="mob-text-btn" disabled={saving} onClick={() => setQty(max)}>
              {t('mobile.putaway.place.all', { qty: max })}
            </button>
          </span>
          <div className="mput-qty">
            <button
              type="button"
              className="mput-step"
              disabled={saving || (qtyValid && qty <= 1)}
              onClick={() => stepQty(-1)}
              aria-label={t('mobile.putaway.place.minus')}
            >
              −
            </button>
            {/* 누르면 숫자패드 — 폰 키보드는 띄우지 않는다 */}
            <button
              type="button"
              className={`mput-qty-input${qtyValid ? '' : ' is-bad'}`}
              disabled={saving}
              aria-label={t('storage.putaway.qty')}
              onClick={() => setNumPadOpen(true)}
            >
              {qty}
            </button>
            <button
              type="button"
              className="mput-step"
              disabled={saving || (qtyValid && qty >= max)}
              onClick={() => stepQty(1)}
              aria-label={t('mobile.putaway.place.plus')}
            >
              +
            </button>
          </div>
        </div>
      </main>

      {/* 아래 버튼 — [배치] */}
      <div className="mput-bottom">
        <button type="button" className="mob-btn accent" disabled={busy !== null} onClick={handleSave}>
          {submitLabel}
        </button>
      </div>

      {/* 수량 숫자패드 */}
      {numPadOpen && (
        <NumPadSheet
          value={qty}
          max={max}
          onConfirm={(n) => { setQty(n); setNumPadOpen(false); }}
          onClose={() => setNumPadOpen(false)}
        />
      )}
    </div>
  );
};

export default PlaceScreen;
