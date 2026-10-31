import React, { useEffect } from 'react';

// ============================================================
// 번역 툴팁 — 주문내역 셀에 마우스를 올리면 한국어 번역을 띄운다
//
//   표가 overflow-x 스크롤 영역 안에 있어 absolute 툴팁은 잘린다.
//   → 셀 위치(getBoundingClientRect)를 받아 position: fixed 로 그린다.
//   스크롤하면 셀과 위치가 어긋나므로 닫는다.
// ============================================================

export interface TooltipState {
  text: string;
  rect: DOMRect;
}

interface Props {
  tip: TooltipState | null;
  onClose: () => void;
}

/** 아래 공간이 이보다 작으면 셀 위쪽에 띄운다 (px) */
const FLIP_THRESHOLD = 120;
const GAP = 4;

const TranslationTooltip: React.FC<Props> = ({ tip, onClose }) => {
  // ── 스크롤 시 닫기 (표 내부 가로 스크롤 포함 → capture) ──
  useEffect(() => {
    if (!tip) return;
    window.addEventListener('scroll', onClose, true);
    return () => window.removeEventListener('scroll', onClose, true);
  }, [tip, onClose]);

  if (!tip) return null;

  const { rect } = tip;
  const below = window.innerHeight - rect.bottom >= FLIP_THRESHOLD;
  const style: React.CSSProperties = below
    ? { left: rect.left, top: rect.bottom + GAP }
    : { left: rect.left, bottom: window.innerHeight - rect.top + GAP };

  return (
    <div className="oi-tooltip" style={style} role="tooltip">
      {tip.text}
    </div>
  );
};

export default TranslationTooltip;
