'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { playErrorSound } from '../utils/storageFormat';
import type { WowBox } from './WowTable';

// ============================================================
// WowSeqModal — [순서지정] : 박스 라벨 바코드(발주번호-박스번호)를 실을 순서대로 스캔
//   (로켓 쉽먼트 화면의 [순서지정] 과 같은 방식 — USB 스캐너가 값 + Enter 를 넣는다)
//
//   · 대상은 서류준비 박스 (이미 순서가 있는 박스를 다시 찍어도 된다)
//   · 발주번호만 찍은 것은 받지 않는다 — 발주서의 박스가 한 번에 다 나가지 않는다
//   · 저장 = 전체 교체: 이번에 찍지 않은 "순서지정" 박스는 순서가 지워져 서류준비로 돌아간다
//   · 잘못 찍은 것은 ✕ 로 뺀다
// ============================================================

interface WowSeqModalProps {
  /** 순서를 줄 수 있는 박스 (서류준비 + 순서지정 단계) */
  candidates: WowBox[];
  /** 저장 — 찍은 순서의 박스 id. 성공하면 true (창을 닫는다) */
  onSave: (boxIds: string[]) => Promise<boolean>;
  onClose: () => void;
}

/** 박스 라벨 값: 발주번호-박스번호 (공백은 무시) */
const LABEL_RE = /^(\d+)-(\d+)$/;
const ORDER_ONLY_RE = /^\d+$/;

const WowSeqModal: React.FC<WowSeqModalProps> = ({ candidates, onSave, onClose }) => {
  const { t } = useTranslation();
  const [scanned, setScanned] = useState<WowBox[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── 라벨 값 → 박스 (같은 발주번호-박스번호가 두 사업자에 있으면 고를 수 없다) ──
  const byLabel = useMemo(() => {
    const map = new Map<string, WowBox[]>();
    for (const b of candidates) {
      const key = `${b.lines[0].order_number}-${b.lines[0].box_no}`;
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [candidates]);

  const reject = useCallback((message: string) => {
    playErrorSound();
    setError(message);
  }, []);

  const handleScan = useCallback((raw: string) => {
    const code = raw.replace(/\s+/g, '');
    if (!code) return;
    if (ORDER_ONLY_RE.test(code)) { reject(t('storage.wow.seq.orderOnly', { code })); return; }
    const m = LABEL_RE.exec(code);
    if (!m) { reject(t('storage.wow.seq.badCode', { code })); return; }
    const label = `${m[1]}-${Number(m[2])}`;
    const hits = byLabel.get(label) ?? [];
    if (hits.length === 0) { reject(t('storage.wow.seq.notDocs', { code: label })); return; }
    if (hits.length > 1) { reject(t('storage.wow.seq.ambiguous', { code: label })); return; }
    if (scanned.some((b) => b.id === hits[0].id)) { reject(t('storage.wow.seq.duplicate', { code: label })); return; }
    setError('');
    setScanned((prev) => [...prev, hits[0]]);
  }, [byLabel, scanned, reject, t]);

  const handleRemove = (id: string) => {
    setScanned((prev) => prev.filter((b) => b.id !== id));
    inputRef.current?.focus();
  };

  const handleSave = async () => {
    if (scanned.length === 0 || saving) return;
    setSaving(true);
    const ok = await onSave(scanned.map((b) => b.id));
    setSaving(false);
    if (ok) onClose();
  };

  const orderCount = new Set(scanned.map((b) => `${b.lines[0].user_id}|${b.lines[0].order_number}`)).size;

  return (
    <div className="storage-modal-overlay">
      <div className="storage-modal storage-modal--wide" role="dialog" aria-label={t('storage.wow.seq.title')}>
        <div className="storage-modal-head">
          <h3>
            {t('storage.wow.seq.title')}
            <span className="wow-modal-sub">{t('storage.wow.seq.candidates', { count: candidates.length })}</span>
          </h3>
          <button type="button" className="storage-modal-x" onClick={onClose} disabled={saving}>✕</button>
        </div>

        {/* ── 스캔 입력 ── */}
        <input
          ref={inputRef}
          className="storage-input wow-seq-input"
          placeholder={t('storage.wow.seq.placeholder')}
          autoComplete="off"
          disabled={saving}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const value = e.currentTarget.value;
            e.currentTarget.value = '';
            handleScan(value);
          }}
        />

        {/* ── 찍은 순서 ── */}
        <div className="wow-seq-list">
          {scanned.length === 0 ? (
            <span className="wow-seq-empty">{t('storage.wow.seq.empty')}</span>
          ) : scanned.map((b, i) => (
            <span key={b.id} className="wow-seq-chip">
              <span className="wow-seq-num">{i + 1}</span>
              {b.lines[0].order_number}-{b.lines[0].box_no}
              <button type="button" aria-label={t('storage.wow.seq.remove')} onClick={() => handleRemove(b.id)} disabled={saving}>✕</button>
            </span>
          ))}
        </div>

        <div className="wow-seq-stat">
          {scanned.length > 0 && t('storage.wow.seq.stat', { orders: orderCount, boxes: scanned.length })}
        </div>
        {error && <div className="storage-message is-error">{error}</div>}

        <div className="storage-modal-actions">
          <button type="button" className="storage-btn" onClick={() => { setScanned([]); setError(''); inputRef.current?.focus(); }}
            disabled={saving || scanned.length === 0}>
            {t('storage.wow.seq.clearAll')}
          </button>
          <button type="button" className="storage-btn" onClick={onClose} disabled={saving}>{t('storage.close')}</button>
          <button type="button" className="storage-btn storage-btn--primary" onClick={handleSave}
            disabled={saving || scanned.length === 0}>
            {saving ? t('storage.saving') : t('storage.wow.seq.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WowSeqModal;
