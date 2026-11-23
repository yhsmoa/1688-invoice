'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkCard } from '../../../storage/types';
import SheetCardInfo from './SheetCardInfo';
import './WowSheet.css';

// ============================================================
// MemoSheet — 카드 메모
//   찾음 · 부족 표시와 따로 저장된다. [지우기] = 메모 삭제, [저장] = 적은 내용 저장
//   저장은 부르는 쪽(DeckScreen)이 한다 — 성공하면 창을 닫아 준다
// ============================================================

/** 메모 최대 글자 수 (서버 규칙과 같다) */
const MEMO_MAX_LENGTH = 500;

interface MemoSheetProps {
  card: WowWorkCard;
  /** 저장 중 — 버튼을 잠근다 */
  busy: boolean;
  /** '' = 메모 지우기 */
  onSave: (memo: string) => void;
  onClose: () => void;
  notify: (text: string) => void;
}

const MemoSheet: React.FC<MemoSheetProps> = ({ card, busy, onSave, onClose, notify }) => {
  const { t } = useTranslation();
  const [text, setText] = useState(card.memo ?? '');
  const title = card.memo ? t('mobile.wow.memoSheet.editTitle') : t('mobile.wow.memoSheet.title');

  const save = () => {
    const memo = text.trim();
    if (!memo) { notify(t('mobile.wow.memoSheet.needText')); return; }
    onSave(memo);
  };

  return (
    <div className="mwow-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mwow-sheet" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <SheetCardInfo card={card} />

        <textarea
          className="mwow-memo-text"
          value={text}
          maxLength={MEMO_MAX_LENGTH}
          placeholder={t('mobile.wow.memoSheet.placeholder')}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mwow-sheet-row">
          <button type="button" className="mob-btn secondary" disabled={busy || !card.memo} onClick={() => onSave('')}>
            {t('mobile.wow.memoSheet.clear')}
          </button>
          <button type="button" className="mob-btn accent" disabled={busy} onClick={save}>
            {t('mobile.wow.memoSheet.save')}
          </button>
        </div>
        <button type="button" className="mwow-sheet-close" onClick={onClose}>{t('mobile.wow.memoSheet.close')}</button>
      </div>
    </div>
  );
};

export default MemoSheet;
