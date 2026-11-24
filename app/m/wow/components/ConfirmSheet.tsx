'use client';

import React from 'react';
import './WowSheet.css';

// ============================================================
// ConfirmSheet — 되돌리기 어려운 일을 하기 전에 한 번 더 묻는 창
//   (부족이 있는 박스의 [작업완료] — 찾은 수량만 출고된다는 것을 알린다)
// ============================================================

interface ConfirmSheetProps {
  title: string;
  text: string;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
}

const ConfirmSheet: React.FC<ConfirmSheetProps> = ({ title, text, yesLabel, noLabel, onYes, onNo }) => (
  <div className="mob-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onNo(); }}>
    <div className="mob-sheet" role="alertdialog" aria-label={title}>
      <h2>{title}</h2>
      <p className="mwow-sheet-text">{text}</p>
      <div className="mwow-sheet-row is-confirm">
        <button type="button" className="mob-btn secondary" onClick={onNo}>{noLabel}</button>
        <button type="button" className="mob-btn accent" onClick={onYes}>{yesLabel}</button>
      </div>
    </div>
  </div>
);

export default ConfirmSheet;
