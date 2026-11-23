'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playErrorSound } from '../utils/storageFormat';
import type { WowBox } from './WowTable';

// ============================================================
// WowPackModal — [합포장] : 부착완료한 박스(합포장 탭에서 아직 정하지 않은 박스)를 마대에 담거나 그대로 출고로 정한다
//
//   담을 곳  [새 마대] · [마대 n] (출고준비 전 마대) · [그대로 출고] (큰 박스 — 박스 하나가 마킹 상자 하나)
//   담을 박스 체크하거나, 박스 라벨 바코드(발주번호-박스번호)를 찍으면 체크된다
//   · 이미 마킹번호가 붙은 박스(옛 방식으로 담은 박스)는 마대에 담을 수 없다 → [그대로 출고] 만
//   저장하면 그 박스에 마대 번호(또는 그대로 출고)가 붙는다. 마킹번호는 [출고준비완료] 때 붙는다
// ============================================================

/** 담을 곳 — 'new' = 새 마대, null = 그대로 출고, 그 밖 = 마대 id */
export type WowPackTarget = 'new' | string | null;

export interface WowOpenBag {
  id: string;
  bag_no: number;
  /** 지금 담겨 있는 박스 수 */
  count: number;
}

interface WowPackModalProps {
  /** 합포장할 수 있는 박스 (부착완료했고 아직 정하지 않은 박스, 순서대로) */
  candidates: WowBox[];
  /** 더 담을 수 있는 마대 (출고준비 전) */
  openBags: WowOpenBag[];
  /** 저장 — 성공하면 true (창을 닫는다) */
  onSave: (boxIds: string[], target: WowPackTarget) => Promise<boolean>;
  onClose: () => void;
}

const LABEL_RE = /^(\d+)-(\d+)$/;
const KEEP = '__keep__';

const WowPackModal: React.FC<WowPackModalProps> = ({ candidates, openBags, onSave, onClose }) => {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string>('new');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const byLabel = useMemo(() => {
    const map = new Map<string, WowBox[]>();
    for (const b of candidates) {
      const key = `${b.lines[0].order_number}-${b.lines[0].box_no}`;
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [candidates]);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  // ── 박스 라벨을 찍으면 그 박스가 체크된다 ──
  const handleScan = useCallback((raw: string) => {
    const m = LABEL_RE.exec(raw.replace(/\s+/g, ''));
    const hits = m ? byLabel.get(`${m[1]}-${Number(m[2])}`) ?? [] : [];
    if (hits.length !== 1) {
      playErrorSound();
      setError(t(hits.length > 1 ? 'storage.wow.seq.ambiguous' : 'storage.wow.pack.notSeq', { code: raw.trim() }));
      return;
    }
    setError('');
    setPicked((prev) => new Set(prev).add(hits[0].id));
  }, [byLabel, t]);

  const pickedBoxes = candidates.filter((b) => picked.has(b.id));
  const intoBag = target !== KEEP;
  // 마킹번호가 이미 있는 박스는 마대에 담지 못한다
  const blocked = intoBag ? pickedBoxes.filter((b) => b.lines[0].box_code) : [];

  const handleSave = async () => {
    if (pickedBoxes.length === 0 || blocked.length > 0 || saving) return;
    setSaving(true);
    const ok = await onSave(pickedBoxes.map((b) => b.id), target === KEEP ? null : target);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal storage-modal--wide" role="dialog" aria-label={t('storage.wow.pack.title')}>
        <div className="storage-modal-head">
          <h3>
            {t('storage.wow.pack.title')}
            <span className="wow-modal-sub">{t('storage.wow.pack.candidates', { count: candidates.length })}</span>
          </h3>
          <button type="button" className="storage-modal-x" onClick={onClose} disabled={saving}>✕</button>
        </div>

        {/* ── 담을 곳 ── */}
        <div className="storage-modal-field">
          <label>{t('storage.wow.pack.target')}</label>
          <div className="wow-pack-targets">
            <button type="button" className={`wow-pack-target ${target === 'new' ? 'is-on' : ''}`}
              onClick={() => setTarget('new')} disabled={saving}>
              {t('storage.wow.pack.newBag')}
            </button>
            {openBags.map((g) => (
              <button key={g.id} type="button" className={`wow-pack-target ${target === g.id ? 'is-on' : ''}`}
                onClick={() => setTarget(g.id)} disabled={saving}>
                {t('storage.wow.bag', { no: g.bag_no })}
                <span className="wow-toolbar-count">{g.count}</span>
              </button>
            ))}
            <button type="button" className={`wow-pack-target ${target === KEEP ? 'is-on' : ''}`}
              onClick={() => setTarget(KEEP)} disabled={saving}>
              {t('storage.wow.pack.keep')}
            </button>
          </div>
          <div className="wow-muted">{t(intoBag ? 'storage.wow.pack.bagHint' : 'storage.wow.pack.keepHint')}</div>
        </div>

        {/* ── 담을 박스: 스캔 또는 체크 ── */}
        <input
          ref={inputRef}
          className="storage-input wow-seq-input"
          placeholder={t('storage.wow.pack.placeholder')}
          autoComplete="off"
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const value = e.currentTarget.value;
            e.currentTarget.value = '';
            if (value.trim()) handleScan(value);
          }}
        />

        <div className="wow-pack-list">
          {candidates.length === 0 && <span className="wow-seq-empty">{t('storage.wow.pack.empty')}</span>}
          {candidates.map((b) => {
            const head = b.lines[0];
            return (
              <label key={b.id} className={`wow-pack-row ${picked.has(b.id) ? 'is-on' : ''}`}>
                <input type="checkbox" className="wow-check" checked={picked.has(b.id)} onChange={() => toggle(b.id)} disabled={saving} />
                <span className="wow-seq-num">{head.ship_seq}</span>
                <strong>{head.order_number}-{head.box_no}</strong>
                <span className="wow-muted">{[head.center, head.box_size].filter(Boolean).join(' · ')}</span>
                {head.box_code && <span className="wow-picked-box">{head.box_code}</span>}
              </label>
            );
          })}
        </div>

        {blocked.length > 0 && (
          <div className="storage-message is-error">
            {t('storage.wow.pack.hasCarton', { boxes: blocked.map((b) => `${b.lines[0].order_number}-${b.lines[0].box_no}`).join(', ') })}
          </div>
        )}
        {error && <div className="storage-message is-error">{error}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={onClose} disabled={saving}>{t('storage.close')}</button>
          <button type="button" className="storage-btn storage-btn--primary" onClick={handleSave}
            disabled={saving || pickedBoxes.length === 0 || blocked.length > 0}>
            {saving ? t('storage.saving') : t('storage.wow.pack.save', { count: pickedBoxes.length })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WowPackModal;
