'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowStage } from '../types';

// ============================================================
// WowToolbar — 와우출고 박스 목록 바로 위 한 줄
//
//   왼쪽  [☐ 전체 선택 n/m] [모두 펼치기 | 모두 접기]
//   오른쪽 (서류준비 탭) [택배엑셀] [출고준비완료]  — 체크한 박스가 대상 (없으면 비활성)
//          (모든 탭)     [전체|선택 부착문서] [전체|선택 동봉문서]
//                        — 체크한 박스가 있으면 그 박스만, 없으면 지금 보이는 박스 전부
// ============================================================

export type WowDocKind = 'label' | 'manifest';
/** 처리 중인 버튼 (한 번에 하나만 — 나머지 버튼도 잠근다) */
export type WowTool = WowDocKind | 'courier' | 'ready';

export const WOW_DOC_KINDS: readonly WowDocKind[] = ['label', 'manifest'];

interface WowToolbarProps {
  stage: WowStage;
  /** 지금 탭의 박스 수 · 그중 체크한 박스 수 */
  total: number;
  checkedCount: number;
  allExpanded: boolean;
  /** 서류 버튼 대상 박스 중 그 서류가 도착한 박스 수 */
  docCounts: Record<WowDocKind, number>;
  busy: WowTool | '';
  onToggleAll: () => void;
  onToggleExpandAll: () => void;
  onDocs: (kind: WowDocKind) => void;
  onCourier: () => void;
  onReady: () => void;
}

const WowToolbar: React.FC<WowToolbarProps> = ({
  stage, total, checkedCount, allExpanded, docCounts, busy,
  onToggleAll, onToggleExpandAll, onDocs, onCourier, onReady,
}) => {
  const { t } = useTranslation();
  const allRef = useRef<HTMLInputElement>(null);
  const locked = busy !== '';
  const hasChecked = checkedCount > 0;

  // 일부만 체크 = 가운데 줄 표시 (indeterminate 는 속성이 없어 DOM 에 직접 넣는다)
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = hasChecked && checkedCount < total;
  }, [hasChecked, checkedCount, total]);

  return (
    <div className="wow-toolbar">
      <div className="wow-toolbar-group">
        <label className="wow-checkall">
          <input ref={allRef} type="checkbox" className="wow-check"
            checked={total > 0 && checkedCount === total} onChange={onToggleAll} />
          {t('storage.wow.selectAll')}
          <span className="wow-toolbar-count">{checkedCount} / {total}</span>
        </label>
        <button type="button" className="wow-btn" onClick={onToggleExpandAll}>
          {t(allExpanded ? 'storage.wow.collapseAll' : 'storage.wow.expandAll')}
        </button>
      </div>

      <div className="wow-toolbar-group">
        {stage === 'docs' && (
          <>
            <button type="button" className="wow-btn" onClick={onCourier}
              disabled={locked || !hasChecked} title={t('storage.wow.courierHint')}>
              {t('storage.wow.courier')}
              <span className="wow-toolbar-count">{checkedCount}</span>
            </button>
            <button type="button" className="wow-btn is-complete" onClick={onReady}
              disabled={locked || !hasChecked} title={t('storage.wow.readyHint')}>
              {t('storage.wow.ready')}
              <span className="wow-toolbar-count">{checkedCount}</span>
            </button>
            <span className="wow-doc-sep" aria-hidden="true" />
          </>
        )}
        {WOW_DOC_KINDS.map((kind) => (
          <button key={kind} type="button" className="wow-btn is-doc" onClick={() => onDocs(kind)}
            disabled={locked || docCounts[kind] === 0}
            title={t('storage.wow.allDocsHint', { count: docCounts[kind], total: hasChecked ? checkedCount : total })}>
            {t(hasChecked ? 'storage.wow.selectedDocs' : 'storage.wow.allDocs', { doc: t(`storage.wow.${kind}`) })}
            <span className="wow-toolbar-count">{docCounts[kind]}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default WowToolbar;
