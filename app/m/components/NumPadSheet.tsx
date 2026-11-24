'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './NumPadSheet.css';

// ============================================================
// NumPadSheet — 수량 입력용 숫자패드 (폰 키보드 대신, 아래에서 올라오는 창)
//   로켓 웹(coupangRocket-web-production numpad.js)의 숫자패드와 같은 규칙
//
//   · 열면 지금 값이 보이고, 처음 누른 숫자부터 새로 입력된다 (지우고 입력할 필요 없음)
//   · C = 모두 지우기 · ← = 한 글자 지우기
//   · 최대를 넘으면 값을 깎지 않고 빨갛게 보여 주며 [확인] 만 막는다
//     (잘못 누른 줄 모르고 다른 수로 저장되는 실수를 막는다)
//   · 바깥(어두운 곳)을 누르거나 [취소] = 바꾸지 않고 닫기
// ============================================================

/** 입력할 수 있는 자릿수 */
const MAX_DIGITS = 6;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'back'] as const;
type Key = typeof KEYS[number];

interface NumPadSheetProps {
  /** 창 제목 (없으면 "수량 입력") */
  title?: string;
  /** 열 때 보여 줄 지금 값 */
  value: number;
  min?: number;
  max: number;
  onConfirm: (value: number) => void;
  onClose: () => void;
}

const NumPadSheet: React.FC<NumPadSheetProps> = ({ title, value, min = 1, max, onConfirm, onClose }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(String(value));
  /** 처음 누르는 숫자가 지금 값을 지우고 새로 시작한다 */
  const [fresh, setFresh] = useState(true);

  const n = text === '' ? NaN : Number(text);
  const over = Number.isFinite(n) && n > max;
  const valid = Number.isInteger(n) && n >= min && !over;

  // ── 키 누름 ──
  const press = (key: Key) => {
    if (key === 'C') { setText(''); setFresh(false); return; }
    if (key === 'back') { setText((s) => (fresh ? '' : s.slice(0, -1))); setFresh(false); return; }
    setText((s) => ((fresh ? '' : s) + key).replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS));
    setFresh(false);
  };

  const confirm = () => { if (valid) onConfirm(n); };

  return (
    <div className="mob-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mob-sheet np-sheet" role="dialog" aria-label={title ?? t('mobile.numpad.title')}>
        <div className="np-head">
          <h2>{title ?? t('mobile.numpad.title')}</h2>
          <span className="np-max">{t('mobile.numpad.max', { max })}</span>
        </div>

        <div className={`np-display${over ? ' is-over' : ''}${fresh ? ' is-fresh' : ''}`} aria-live="polite">
          {text || '0'}
        </div>
        {over && <p className="np-over">{t('mobile.numpad.over', { max })}</p>}

        <div className="np-grid">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`np-key${key === 'C' || key === 'back' ? ' is-fn' : ''}`}
              onClick={() => press(key)}
              aria-label={key === 'C' ? t('mobile.numpad.clear') : key === 'back' ? t('mobile.numpad.back') : key}
            >
              {key === 'back' ? '←' : key}
            </button>
          ))}
        </div>

        <div className="np-btns">
          <button type="button" className="mob-btn secondary" onClick={onClose}>{t('mobile.numpad.cancel')}</button>
          <button type="button" className="mob-btn accent" disabled={!valid} onClick={confirm}>{t('mobile.numpad.ok')}</button>
        </div>
      </div>
    </div>
  );
};

export default NumPadSheet;
