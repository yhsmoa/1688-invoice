'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WowStage } from '../types';
import { WOW_SHIPPED_VISIBLE_DAYS, WOW_STAGES } from '../utils/wowStage';

// ============================================================
// WowStageTabs — 와우출고 단계 바 [1 신규] › [2 작업중] › [3 작업완료] › [4 서류준비] › [5 출고준비] › [6 출고]
//   한 판 6칸. 칸마다 번호 · 이름 · 박스 수(크게) · 그 단계의 뜻. 선택 칸은 단계 색 밑줄 + 옅은 바탕
//   (클로드 디자인 캔버스 "와우출고 화면 디자인" — 쉽먼트 V2 타입 바와 같은 모양)
// ============================================================

interface WowStageTabsProps {
  stage: WowStage;
  /** 단계별 박스 수 */
  counts: Record<WowStage, number>;
  onChange: (stage: WowStage) => void;
}

const WowStageTabs: React.FC<WowStageTabsProps> = ({ stage, counts, onChange }) => {
  const { t } = useTranslation();

  return (
    <nav className="wow-stagebar" aria-label={t('storage.tabs.wow')}>
      {WOW_STAGES.map((s, i) => (
        <button
          key={s}
          type="button"
          className={`wow-stage is-${s} ${stage === s ? 'is-active' : ''}`}
          aria-pressed={stage === s}
          onClick={() => onChange(s)}
        >
          <span className="wow-stage-top">
            <span className="wow-stage-num">{i + 1}</span>
            <span className="wow-stage-label">{t(`storage.wow.stage.${s}`)}</span>
            {i < WOW_STAGES.length - 1 && (
              <svg className="wow-stage-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            )}
          </span>
          <span className={`wow-stage-count ${counts[s] === 0 ? 'is-zero' : ''}`}>
            {counts[s]}
            <span className="wow-stage-unit">{t('storage.wow.boxUnit')}</span>
          </span>
          <span className="wow-stage-sub">{t(`storage.wow.stageSub.${s}`, { days: WOW_SHIPPED_VISIBLE_DAYS })}</span>
        </button>
      ))}
    </nav>
  );
};

export default WowStageTabs;
