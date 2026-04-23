'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import './RightActionSidebar.css';

// ============================================================
// /import-product-v2 전용 우측 액션 사이드바
//
// 목적: 테이블 스크롤 중에도 5개 주요 액션(비고/반품/미입고/라벨/입고)에
//       즉시 접근 가능하도록 상단 액션 바에서 분리 후 우측 고정.
//
// 레이아웃:
//   - position: fixed, right: 0, height: 100vh, width: 70px
//   - 좌측 사이드바 감소분(280→210, −70px) 보상 → 메인 콘텐츠 영역 불변
//
// 디자인:
//   - 검은 배경(#111827), 버튼은 세로 스택
//   - 이모지(22px) 위, 라벨(10px) 아래
// ============================================================

interface RightActionSidebarProps {
  // ── 이벤트 핸들러 ──
  onNoteClick:    () => void;
  onCancelClick:  () => void;
  onMissingClick: () => void;
  onLabelClick:   () => void;
  onImportClick:  () => void;
  // ── 버튼별 disabled 여부 ──
  /** 사용자 미선택 또는 데이터 0건 시 비활성화 (5개 버튼 공통) */
  disabled: boolean;
  // ── 입고 버튼 뱃지 (작업 수량 입력된 항목 수) ──
  importBadgeCount: number;
}

type ActionKey = 'note' | 'cancel' | 'missing' | 'label' | 'import';

interface ActionMeta {
  key:   ActionKey;
  emoji: string;
  /** i18n key */
  labelKey: string;
}

// ── 버튼 메타 정의 (고정 순서: 비고 → 반품 → 미입고 → 라벨 → 입고) ──
const ACTIONS: ActionMeta[] = [
  { key: 'note',    emoji: '📝', labelKey: 'importProductV2.buttons.note' },
  { key: 'cancel',  emoji: '↩️', labelKey: 'importProductV2.buttons.cancel' },
  { key: 'missing', emoji: '⚠️', labelKey: 'importProductV2.buttons.missing' },
  { key: 'label',   emoji: '🏷️', labelKey: 'importProductV2.buttons.label' },
  { key: 'import',  emoji: '📥', labelKey: 'importProductV2.buttons.import' },
];

const RightActionSidebar: React.FC<RightActionSidebarProps> = ({
  onNoteClick,
  onCancelClick,
  onMissingClick,
  onLabelClick,
  onImportClick,
  disabled,
  importBadgeCount,
}) => {
  const { t } = useTranslation();

  const handlerMap: Record<ActionKey, () => void> = {
    note:    onNoteClick,
    cancel:  onCancelClick,
    missing: onMissingClick,
    label:   onLabelClick,
    import:  onImportClick,
  };

  return (
    <aside className="v2-right-action-sidebar">
      {ACTIONS.map(({ key, emoji, labelKey }) => {
        const isImport = key === 'import';
        const showBadge = isImport && importBadgeCount > 0;

        return (
          <button
            key={key}
            className={`v2-right-action-btn ${showBadge ? 'has-items' : ''}`}
            onClick={handlerMap[key]}
            disabled={disabled}
            type="button"
          >
            <span className="v2-right-action-emoji">{emoji}</span>
            <span className="v2-right-action-label">{t(labelKey)}</span>
            {showBadge && (
              <span className="v2-right-action-badge">{importBadgeCount}</span>
            )}
          </button>
        );
      })}
    </aside>
  );
};

export default RightActionSidebar;
