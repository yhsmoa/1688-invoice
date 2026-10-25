'use client';

import React, { useCallback, useEffect } from 'react';

// ============================================================
// 이미지 확대 보기 (라이트박스) — 상품 원본 + 첨부 이미지를 ◀ ▶ 로 넘긴다
//   Esc / 배경 클릭으로 닫기, ← → 키로 이동
// ============================================================

interface Props {
  urls: string[];
  index: number;
  onChange: (next: number) => void;
  onClose: () => void;
}

const CheckImageViewer: React.FC<Props> = ({ urls, index, onChange, onClose }) => {
  const prev = useCallback(() => onChange((index - 1 + urls.length) % urls.length), [index, urls.length, onChange]);
  const next = useCallback(() => onChange((index + 1) % urls.length), [index, urls.length, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  if (urls.length === 0) return null;

  return (
    <div className="cc-viewer-overlay" onClick={onClose}>
      <button type="button" className="cc-viewer-close" onClick={onClose} aria-label="close">×</button>
      {urls.length > 1 && (
        <button type="button" className="cc-viewer-nav is-prev" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="prev">‹</button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[index]} alt="" className="cc-viewer-img" onClick={(e) => e.stopPropagation()} />
      {urls.length > 1 && (
        <button type="button" className="cc-viewer-nav is-next" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="next">›</button>
      )}
      <div className="cc-viewer-counter">{index + 1} / {urls.length}</div>
    </div>
  );
};

export default CheckImageViewer;
