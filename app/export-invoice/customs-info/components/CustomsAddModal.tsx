'use client';

import React, { useEffect, useMemo, useState } from 'react';
import './CustomsAddModal.css';

// ============================================================
// CustomsAddModal — 통관정보 1건 추가 ([+ 품목 추가])
//
//   입력: 품명(한글)* · 품명(영문)* · HS CODE · 원산지발급
//     · 품명(한글)은 쉽먼트 품목 저장 키 — 쉽먼트 드롭다운에는 영문으로 보인다
//     · HS CODE 는 몰라도 저장 가능 (비우면 NULL)
//     · 원산지발급은 기존 값(FTA, 아태 …)을 datalist 로 제안, 새 값도 입력 가능
//   저장: POST /api/add-customs-item — 같은 HS CODE 가 있으면 저장하지 않는다
// ============================================================
export interface CustomsItem {
  id: number;
  HS_code?: string | null;
  item_name_ko?: string;
  item_name_en?: string;
  CO?: string;
}

interface CustomsAddModalProps {
  /** 현재 목록 — HS CODE 중복 사전 확인 · 원산지 제안값 */
  existing: CustomsItem[];
  onClose: () => void;
  onAdded: (item: CustomsItem) => void;
}

const CustomsAddModal: React.FC<CustomsAddModalProps> = ({ existing, onClose, onAdded }) => {
  // ============================================================
  // 상태
  // ============================================================
  const [nameKo, setNameKo] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [hsCode, setHsCode] = useState('');
  const [co, setCo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── 파생값 ──
  const coOptions = useMemo(
    () => Array.from(new Set(existing.map((r) => (r.CO || '').trim()).filter(Boolean))).sort(),
    [existing]
  );
  const hsDuplicate = useMemo(() => {
    const code = hsCode.trim();
    return !!code && existing.some((r) => r.HS_code === code);
  }, [existing, hsCode]);
  const koExists = useMemo(() => {
    const ko = nameKo.trim();
    return !!ko && existing.some((r) => (r.item_name_ko || '').trim() === ko);
  }, [existing, nameKo]);

  const canSubmit =
    !!nameKo.trim() && !!nameEn.trim() && !hsDuplicate && !submitting;

  // ── ESC 로 닫기 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // ============================================================
  // 저장
  // ============================================================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/add-customs-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_name_ko: nameKo,
          item_name_en: nameEn,
          HS_code: hsCode,
          CO: co,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || '저장에 실패했습니다.');
        return;
      }
      onAdded(json.data);
    } catch (err) {
      console.error('통관정보 추가 오류:', err);
      setError('저장 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div className="customs-add-overlay" onClick={() => !submitting && onClose()}>
      <form className="customs-add-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        {/* ── 헤더 ── */}
        <div className="customs-add-head">
          <h3>통관 품목 추가</h3>
          <button type="button" className="customs-add-close" onClick={onClose} disabled={submitting}>
            ✕
          </button>
        </div>

        {/* ── 입력 ── */}
        <div className="customs-add-body">
          <label className="customs-add-field">
            <span>품명(한글) <em>*</em></span>
            <input value={nameKo} onChange={(e) => setNameKo(e.target.value)} autoFocus />
            {koExists && (
              <small className="customs-add-hint">
                같은 한글 품명이 이미 있습니다. 쉽먼트에서는 하나의 품목으로 보입니다.
              </small>
            )}
          </label>

          <label className="customs-add-field">
            <span>품명(영문) <em>*</em></span>
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>

          <label className="customs-add-field">
            <span>HS CODE</span>
            <input value={hsCode} onChange={(e) => setHsCode(e.target.value)} />
            {hsDuplicate && <small className="customs-add-error-text">이미 등록된 HS CODE 입니다.</small>}
          </label>

          <label className="customs-add-field">
            <span>원산지발급</span>
            <input value={co} onChange={(e) => setCo(e.target.value)} list="customs-add-co-options" />
            <datalist id="customs-add-co-options">
              {coOptions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>

          {error && <div className="customs-add-error">{error}</div>}
        </div>

        {/* ── 하단 버튼 ── */}
        <div className="customs-add-foot">
          <button type="button" className="customs-add-cancel" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button type="submit" className="customs-add-submit" disabled={!canSubmit}>
            {submitting ? '저장 중...' : '추가'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CustomsAddModal;
