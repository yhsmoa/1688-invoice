'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playErrorSound } from '../utils/storageFormat';
import type { WowBox } from './WowTable';

// ============================================================
// WowPackModal — [합포장] : 부착완료한 박스 중 마대에 같이 담을 박스를 고른다
//
//   담을 곳  [새 마대] · [마대 n] (출고준비 전 마대)
//   담을 박스 체크하거나, 박스 라벨 바코드(발주번호-박스번호)를 찍으면 체크된다
//   저장하면 그 박스에 마대 번호가 붙는다. 마킹번호는 [출고준비완료] 때 마대 하나에 하나만 붙는다
//   마대에 담지 않는 박스는 고르지 않는다 — [출고준비완료] 때 박스 그대로 나간다 (supabase/storage/014_wow_pack_auto.sql)
//   이미 마킹번호가 붙은 박스는 마대에 담을 수 없어 목록에 나오지 않는다 (부르는 쪽이 거른다)
// ============================================================

/** 담을 곳 — 'new' = 새 마대, 그 밖 = 마대 id */
export type WowPackTarget = string;

export interface WowOpenBag {
  id: string;
  bag_no: number;
  /** 지금 담겨 있는 박스 수 */
  count: number;
}

interface WowPackModalProps {
  /** 마대에 담을 수 있는 박스 (부착완료했고 마대 · 마킹번호가 아직 없는 박스, 순서대로) */
  candidates: WowBox[];
  /** 더 담을 수 있는 마대 (출고준비 전) */
  openBags: WowOpenBag[];
  /** 저장 — 성공하면 true (창을 닫는다) */
  onSave: (boxIds: string[], target: WowPackTarget) => Promise<boolean>;
  onClose: () => void;
}

const LABEL_RE = /^(\d+)-(\d+)$/;

const WowPackModal: React.FC<WowPackModalProps> = ({ candidates, openBags, onSave, onClose }) => {
  const { t } = useTranslation();
  const [target, setTarget] = useState<WowPackTarget>('new');
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

  const handleSave = async () => {
    if (pickedBoxes.length === 0 || saving) return;
    setSaving(true);
    const ok = await onSave(pickedBoxes.map((b) => b.id), target);
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
          </div>
          <div className="wow-muted">{t('storage.wow.pack.bagHint')}</div>
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
              </label>
            );
          })}
        </div>

        {error && <div className="storage-message is-error">{error}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={onClose} disabled={saving}>{t('storage.close')}</button>
          <button type="button" className="storage-btn storage-btn--primary" onClick={handleSave}
            disabled={saving || pickedBoxes.length === 0}>
            {saving ? t('storage.saving') : t('storage.wow.pack.save', { count: pickedBoxes.length })}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WowPackModal;
