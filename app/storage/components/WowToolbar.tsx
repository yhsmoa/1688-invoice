'use client';

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { WowStage } from '../types';

// ============================================================
// WowToolbar — 와우출고 박스 목록 바로 위 한 줄
//
//   왼쪽  [☐ 전체 선택 n/m] [모두 펼치기 | 모두 접기]
//   오른쪽 — 단계마다 다르다. 대상 = 체크한 박스 (없으면 그 탭의 박스 전부 — 버튼 안의 숫자가 대상 수)
//     출고 전 탭 [라벨출력]                박스 라벨(발주번호-박스번호).
//               신규 탭은 체크가 없으면 아직 안 뽑은 박스만, 그 밖의 탭은 체크한 박스만 (다시 뽑는 용도)
//     서류준비  [바로 출고준비]            이미 마킹번호가 있는 박스(옛 방식으로 담은 박스)만 — 순서지정 · 합포장 없이 출고준비로.
//               그런 박스가 이 탭에 있을 때만 보인다
//     순서지정  [초기화] [순서지정] [택배엑셀] [부착완료]   순서지정은 서류준비 박스를 스캔하는 창을 연다
//               부착완료 = 서류 · 운송장을 다 붙였다 → 합포장 탭으로 넘어간다 (순서 번호는 그대로)
//     합포장    [합포장] [합포장 취소] [출고준비완료]  합포장은 이 탭에서 아직 정하지 않은 박스를 고르는 창을 연다
//               취소는 체크한 박스만. 출고준비완료는 마대 · 그대로 출고를 정한 박스만
//     출고준비  [마킹라벨]                  마킹번호 라벨 (쉽먼트 V2 의 [마킹라벨] 과 같은 출력물)
//     신규가 아닌 탭  [전체|선택 부착문서] [전체|선택 동봉문서]  — 지금 보이는 순서대로 한 PDF
//     출고 전 탭 [발주취소]  맨 오른쪽. 체크한 박스만 — 잡아 둔 재고가 풀리고 꺼낸 상품은 재고 [작업중] 으로 돌아간다
// ============================================================

export type WowDocKind = 'label' | 'manifest';
/** 처리 중인 버튼 (한 번에 하나만 — 나머지 버튼도 잠근다) */
export type WowTool = WowDocKind | 'boxLabel' | 'readyDirect' | 'seq' | 'seqClear' | 'courier' | 'attach' | 'pack' | 'packClear' | 'ready' | 'marking' | 'drop';

export const WOW_DOC_KINDS: readonly WowDocKind[] = ['label', 'manifest'];

interface WowToolbarProps {
  stage: WowStage;
  /** 지금 탭의 박스 수 · 그중 체크한 박스 수 */
  total: number;
  checkedCount: number;
  allExpanded: boolean;
  /** 버튼별 대상 박스 수 (0 이면 그 버튼은 잠긴다) */
  counts: {
    boxLabel: number;
    /** [바로 출고준비] 대상 (이미 마킹번호가 있는 박스). null = 이 탭에 그런 박스가 없다 → 버튼을 보이지 않는다 */
    readyDirect: number | null;
    /** [순서지정] 창에서 찍을 수 있는 박스 (서류준비 + 순서지정) */
    seqCandidates: number;
    /** [합포장] 창에서 고를 수 있는 박스 (합포장 탭에서 아직 정하지 않은 박스) */
    packCandidates: number;
    /** [합포장 취소] · [출고준비완료] 대상 (마대 · 그대로 출고를 정한 박스) */
    packClear: number;
    ready: number;
    marking: number;
    /** [발주취소] 대상 (체크한 박스만) */
    drop: number;
    docs: Record<WowDocKind, number>;
  };
  busy: WowTool | '';
  onToggleAll: () => void;
  onToggleExpandAll: () => void;
  onBoxLabel: () => void;
  onReadyDirect: () => void;
  onSeqOpen: () => void;
  onSeqClear: () => void;
  onCourier: () => void;
  onAttach: () => void;
  onPackOpen: () => void;
  onPackClear: () => void;
  onReady: () => void;
  onMarking: () => void;
  onDocs: (kind: WowDocKind) => void;
  onDrop: () => void;
}

const WowToolbar: React.FC<WowToolbarProps> = ({
  stage, total, checkedCount, allExpanded, counts, busy,
  onToggleAll, onToggleExpandAll, onBoxLabel, onReadyDirect, onSeqOpen, onSeqClear, onCourier, onAttach, onPackOpen, onPackClear, onReady, onMarking, onDocs, onDrop,
}) => {
  const { t } = useTranslation();
  const allRef = useRef<HTMLInputElement>(null);
  const locked = busy !== '';
  const hasChecked = checkedCount > 0;
  /** 체크한 박스가 있으면 그 박스, 없으면 탭의 박스 전부 */
  const targetCount = hasChecked ? checkedCount : total;
  /** 출고 전 탭 — [라벨출력] · [발주취소] 가 보인다 */
  const beforeShip = stage !== 'shipped';

  // 일부만 체크 = 가운데 줄 표시 (indeterminate 는 속성이 없어 DOM 에 직접 넣는다)
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = hasChecked && checkedCount < total;
  }, [hasChecked, checkedCount, total]);

  const button = (key: string, label: string, count: number | null, onClick: () => void, opts?: { primary?: boolean; hint?: string }) => (
    <button key={key} type="button" className={`wow-btn ${opts?.primary ? 'is-complete' : ''}`} onClick={onClick}
      disabled={locked || count === 0} title={opts?.hint}>
      {label}
      {count !== null && <span className="wow-toolbar-count">{count}</span>}
    </button>
  );

  return (
    <div className="wow-toolbar">
      <div className="wow-toolbar-group">
        <label className="wow-checkall">
          <input ref={allRef} type="checkbox" className="wow-check"
            checked={total > 0 && checkedCount === total} onChange={onToggleAll} disabled={total === 0} />
          {t('storage.wow.selectAll')}
          <span className="wow-toolbar-count">{checkedCount} / {total}</span>
        </label>
        <button type="button" className="wow-btn" onClick={onToggleExpandAll} disabled={total === 0}>
          {t(allExpanded ? 'storage.wow.collapseAll' : 'storage.wow.expandAll')}
        </button>
      </div>

      <div className="wow-toolbar-group">
        {beforeShip && button('boxLabel', t('storage.wow.boxLabel'), counts.boxLabel, onBoxLabel,
          { primary: stage === 'new', hint: t(stage === 'new' ? 'storage.wow.boxLabelHint' : 'storage.wow.boxLabelAgainHint') })}

        {stage === 'docs' && counts.readyDirect !== null && button('readyDirect', t('storage.wow.readyDirect'), counts.readyDirect, onReadyDirect,
          { primary: true, hint: t('storage.wow.readyDirectHint') })}

        {stage === 'seq' && (
          <>
            {button('seqClear', t('storage.wow.seqClear'), targetCount, onSeqClear, { hint: t('storage.wow.seqClearHint') })}
            {button('seq', t('storage.wow.seqSet'), counts.seqCandidates, onSeqOpen, { hint: t('storage.wow.seqSetHint') })}
            {button('courier', t('storage.wow.courier'), targetCount, onCourier, { hint: t('storage.wow.courierHint') })}
            {button('attach', t('storage.wow.attach'), targetCount, onAttach, { primary: true, hint: t('storage.wow.attachHint') })}
          </>
        )}

        {stage === 'pack' && (
          <>
            {button('pack', t('storage.wow.packSet'), counts.packCandidates, onPackOpen, { hint: t('storage.wow.packSetHint') })}
            {button('packClear', t('storage.wow.packClear'), counts.packClear, onPackClear, { hint: t('storage.wow.packClearHint') })}
            {button('ready', t('storage.wow.ready'), counts.ready, onReady, { primary: true, hint: t('storage.wow.readyHint') })}
          </>
        )}

        {stage === 'ready' && button('marking', t('storage.wow.marking'), counts.marking, onMarking,
          { primary: true, hint: t('storage.wow.markingHint') })}

        {stage !== 'new' && (
          <>
            {(stage === 'docs' || stage === 'seq' || stage === 'pack' || stage === 'ready') && <span className="wow-doc-sep" aria-hidden="true" />}
            {WOW_DOC_KINDS.map((kind) => (
              <button key={kind} type="button" className="wow-btn is-doc" onClick={() => onDocs(kind)}
                disabled={locked || counts.docs[kind] === 0}
                title={t('storage.wow.allDocsHint', { count: counts.docs[kind], total: targetCount })}>
                {t(hasChecked ? 'storage.wow.selectedDocs' : 'storage.wow.allDocs', { doc: t(`storage.wow.${kind}`) })}
                <span className="wow-toolbar-count">{counts.docs[kind]}</span>
              </button>
            ))}
          </>
        )}

        {beforeShip && (
          <>
            <span className="wow-doc-sep" aria-hidden="true" />
            {button('drop', t('storage.wow.drop'), counts.drop, onDrop, { hint: t('storage.wow.dropHint') })}
          </>
        )}
      </div>
    </div>
  );
};

export default WowToolbar;
