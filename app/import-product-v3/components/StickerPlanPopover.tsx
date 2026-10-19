'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FtOrderItem } from '../../import-product-v2/hooks/useFtData';
import type { SetStickerLine } from '../utils/stickerPlan';

// ============================================================
// 세트 라벨 스티커 계산표 + 직접 지정
//
//   세트(product_no) | 최대 | 필요 | 출력됨 | 이번 출력 [직접 지정] [자동]
//
// 출력 기록(label_print_logs)은 2026-09-08 부터만 있다. 그 전에 BarTender 로 뽑은
// 세트의 나머지 구성품이 지금 들어오면 계산상 [출력됨]=0 이라 중복 출력이 된다.
// 작업자가 실물을 보고 0 으로 고칠 수 있게 한다. (그 배치에만 적용)
// ============================================================

interface StickerPlanPopoverProps {
  sets: SetStickerLine<FtOrderItem>[];
  disabled: boolean;
  onOverride: (productId: string, qty: number | null) => void;
  onClose: () => void;
}

const StickerPlanPopover: React.FC<StickerPlanPopoverProps> = ({ sets, disabled, onOverride, onClose }) => {
  const { t } = useTranslation();

  return (
    <div className="v3-sticker-popover">
      <div className="v3-sticker-popover-header">
        <strong>{t('importProductV3.stickerPlan.title')}</strong>
        <button type="button" className="v3-icon-btn" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>
      <p className="v3-sticker-popover-hint">{t('importProductV3.stickerPlan.hint')}</p>
      <table className="v3-sticker-table">
        <thead>
          <tr>
            <th>{t('importProductV3.stickerPlan.product')}</th>
            <th>{t('importProductV3.stickerPlan.cap')}</th>
            <th>{t('importProductV3.stickerPlan.target')}</th>
            <th>{t('importProductV3.stickerPlan.printed')}</th>
            <th>{t('importProductV3.stickerPlan.toPrint')}</th>
            <th>{t('importProductV3.stickerPlan.override')}</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => (
            <tr key={s.productId} className={s.overridden ? 'v3-sticker-overridden' : ''}>
              <td>
                {s.productNo ?? s.productId.slice(0, 8)}
                <div className="v3-sticker-sub">{s.rep.item_no}</div>
              </td>
              <td>{s.cap}</td>
              <td>{s.target}</td>
              <td>{s.printed}</td>
              <td className="v3-sticker-toprint">{s.toPrint}</td>
              <td>
                <input
                  className="v3-sticker-input"
                  type="text"
                  inputMode="numeric"
                  value={s.overridden ? String(s.toPrint) : ''}
                  placeholder={String(s.auto)}
                  disabled={disabled}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, '');
                    onOverride(s.productId, cleaned === '' ? null : parseInt(cleaned, 10));
                  }}
                />
                {s.overridden && (
                  <button
                    type="button"
                    className="v3-link-btn"
                    disabled={disabled}
                    onClick={() => onOverride(s.productId, null)}
                  >
                    {t('importProductV3.stickerPlan.auto')}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default StickerPlanPopover;
