'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { WOW_BOX_SIZES } from '../../../storage/utils/wowStage';
import './WowSheet.css';

// ============================================================
// SizeSheet — 담는 박스의 크기 변경
//   (예: 극소 상자에 안 들어가 중 상자로 바꿔 담았을 때 폰에서 바로 고친다)
//
//   · 크기마다 큰 버튼 하나 — 지금 크기는 색으로 표시한다. 누르면 바로 저장한다
//   · 크기 목록은 PC 와 같은 WOW_BOX_SIZES (app/storage/utils/wowStage.ts)
//   · 저장은 부르는 쪽(DeckScreen)이 한다 — 끝나면 창을 닫아 준다
// ============================================================

interface SizeSheetProps {
  /** 발주번호-박스번호 */
  label: string;
  /** 지금 크기 (null = 크기 없음) */
  current: string | null;
  /** 저장 중 — 버튼을 잠근다 */
  busy: boolean;
  onPick: (size: string) => void;
  onClose: () => void;
}

const SizeSheet: React.FC<SizeSheetProps> = ({ label, current, busy, onPick, onClose }) => {
  const { t } = useTranslation();

  return (
    <div className="mob-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mob-sheet" role="dialog" aria-label={t('mobile.wow.size.title')}>
        <h2>{t('mobile.wow.size.title')}</h2>
        <p className="mwow-sheet-info">
          <span><b>{label}</b> · {t('mobile.wow.size.current', { size: current ?? t('mobile.wow.size.none') })}</span>
        </p>

        <div className="mwow-size-grid">
          {WOW_BOX_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className={size === current ? 'is-current' : ''}
              disabled={busy}
              onClick={() => onPick(size)}
            >
              {size}
            </button>
          ))}
        </div>

        <button type="button" className="mob-sheet-close" onClick={onClose}>{t('mobile.wow.size.close')}</button>
      </div>
    </div>
  );
};

export default SizeSheet;
