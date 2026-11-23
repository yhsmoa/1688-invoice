'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowWorkCard } from '../../../storage/types';
import { playErrorSound } from '../../../storage/utils/storageFormat';
import { maxFoundQty } from '../utils/cardState';
import SheetCardInfo from './SheetCardInfo';
import './WowSheet.css';

// ============================================================
// ShortSheet — [부족] · [수정] 숫자판 (위치 카드 전용)
//
//   그 위치에서 실제로 꺼낸 수량을 숫자로 넣는다 (0 = 여기엔 없음).
//   · 넣을 수 있는 범위 = 0 ~ (그 위치 재고와 요청 수량 중 작은 값).
//     처음 몫보다 더 꺼낼 수도 있다 — 합이 요청을 넘으면 서버가 문구와 함께 거절한다
//   · 몫보다 적게 넣으면 나머지는 다른 위치 카드(또는 재고 없음 카드)로 다시 나온다
//   · 폰 자판 대신 화면 숫자판을 쓴다 (자판이 창을 가리지 않게). 범위를 넘는 숫자는 받지 않고 흔들어 알린다
//   · 처음에는 비어 있고, 이미 표시한 카드를 [수정] 으로 열면 적혀 있던 수량부터 시작한다
// ============================================================

/** 숫자판 배열 — clear = 전부 지우기 · back = 한 자리 지우기 */
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const;
type PadKey = (typeof PAD_KEYS)[number];

interface ShortSheetProps {
  card: WowWorkCard;
  onConfirm: (foundQty: number) => void;
  onClose: () => void;
  notify: (text: string) => void;
}

const ShortSheet: React.FC<ShortSheetProps> = ({ card, onConfirm, onClose, notify }) => {
  const { t } = useTranslation();
  const marked = card.found_qty !== null;
  const [value, setValue] = useState(() => (card.found_qty !== null ? String(card.found_qty) : ''));
  /** 흔들기를 다시 시작시키는 번호 */
  const [shakeSeq, setShakeSeq] = useState(0);
  const max = maxFoundQty(card);

  // ── 숫자판 누름 ──
  const press = (key: PadKey) => {
    if (key === 'clear') { setValue(''); return; }
    if (key === 'back') { setValue((v) => v.slice(0, -1)); return; }
    const next = Number((value === '0' ? '' : value) + key);
    if (next > max) {
      setShakeSeq((n) => n + 1);
      playErrorSound();
      notify(t('mobile.wow.shortSheet.over', { qty: max }));
      return;
    }
    setValue(String(next));
  };

  const keyLabel = (key: PadKey) =>
    key === 'clear' ? t('mobile.wow.shortSheet.clear') : key === 'back' ? '⌫' : key;

  return (
    <div className="mwow-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mwow-sheet" role="dialog" aria-label={t('mobile.wow.shortSheet.title')}>
        <h2>{t('mobile.wow.shortSheet.title')}</h2>
        <SheetCardInfo card={card} />

        {/* 넣은 수량 (아직 표시하지 않은 카드는 옆에 꺼낼 몫을 같이 보여 준다) */}
        <div key={shakeSeq} className={`mwow-num${value === '' ? ' is-empty' : ''}${shakeSeq > 0 ? ' is-shake' : ''}`}>
          <span>{value === '' ? t('mobile.wow.shortSheet.placeholder') : t('mobile.wow.shortSheet.value', { qty: value })}</span>
          {!marked && <small>{t('mobile.wow.shortSheet.of', { qty: card.plan_qty })}</small>}
        </div>

        {/* 숫자판 */}
        <div className="mwow-pad">
          {PAD_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={key === 'clear' || key === 'back' ? 'is-fn' : ''}
              onClick={() => press(key)}
            >
              {keyLabel(key)}
            </button>
          ))}
        </div>
        <div className="mwow-sheet-note">{t('mobile.wow.shortSheet.note', { max })}</div>

        <div className="mwow-sheet-row is-confirm">
          <button type="button" className="mob-btn secondary" onClick={onClose}>{t('mobile.wow.shortSheet.cancel')}</button>
          <button type="button" className="mob-btn accent" disabled={value === ''} onClick={() => onConfirm(Number(value))}>
            {t('mobile.wow.shortSheet.ok')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShortSheet;
