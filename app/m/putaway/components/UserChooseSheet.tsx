'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { joinOptions } from '../../../storage/utils/storageFormat';
import type { PendingProduct } from '../types';

// ============================================================
// UserChooseSheet — 같은 주문번호가 여러 사업자에 있을 때 어느 사업자의 상품인지 고르는 창
//   (PC 는 오류로 알리고 사업자 탭을 고르게 하지만, 폰에서는 바로 고르게 한다)
//   사업자마다 큰 버튼 하나 — 누르면 그 상품의 배치 화면으로 간다
// ============================================================

interface UserChooseSheetProps {
  /** 스캔한 주문번호 */
  code: string;
  /** 사업자마다 하나씩 */
  choices: PendingProduct[];
  userCodeOf: (userId: string) => string;
  onPick: (product: PendingProduct) => void;
  onClose: () => void;
}

const UserChooseSheet: React.FC<UserChooseSheetProps> = ({ code, choices, userCodeOf, onPick, onClose }) => {
  const { t } = useTranslation();

  return (
    <div className="mob-sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mob-sheet" role="dialog" aria-label={t('mobile.putaway.choose.title')}>
        <h2>{t('mobile.putaway.choose.title')}</h2>
        <p className="mput-choose-text">{t('mobile.putaway.choose.desc', { code })}</p>

        <div className="mput-choices">
          {choices.map((p) => (
            <button key={p.product_id} type="button" className="mput-choice" onClick={() => onPick(p)}>
              <b>{userCodeOf(p.user_id)}</b>
              <span className="mput-choice-body">
                <span className="mput-choice-name">{p.head.item_name ?? '-'}</span>
                <span className="mput-choice-opt">
                  {joinOptions(p.head.option_name, p.head.china_option1, p.head.china_option2)}
                </span>
              </span>
              <span className="mput-choice-qty">{t('storage.putaway.total', { qty: p.unplaced })}</span>
            </button>
          ))}
        </div>

        <button type="button" className="mob-sheet-close" onClick={onClose}>{t('storage.close')}</button>
      </div>
    </div>
  );
};

export default UserChooseSheet;
