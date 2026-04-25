'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import './RightActionSidebar.css';

// ============================================================
// /import-product-v2 전용 우측 액션 사이드바
//
// 목적: 테이블 스크롤 중에도 주요 액션(입고/라벨/운송장/미입고/반품/비고)에
//       즉시 접근 가능하도록 우측 고정.
//
// 레이아웃:
//   - position: sticky, right: 0, 뷰포트 높이 고정 → 스크롤 시 따라옴
//   - 세로 가운데 정렬
//
// 디자인:
//   - 검은 배경(#111827), 버튼은 세로 스택
//   - 이모지(22px) 위, 라벨(10px) 아래
// ============================================================

interface RightActionSidebarProps {
  // ── 이벤트 핸들러 ──
  onNoteClick:     () => void;
  onCancelClick:   () => void;
  onMissingClick:  () => void;
  onLabelClick:    () => void;
  onImportClick:   () => void;
  onShippingClick: () => void | Promise<void>;
  // ── 버튼별 disabled 여부 ──
  /** 사용자 미선택 또는 데이터 0건 시 비활성화 (공통 버튼 disabled) */
  disabled: boolean;
  /** 운송장 버튼 전용 활성화 — 선택된 행 중 P + PDF 매칭 ≥ 1 일 때 true */
  shippingEnabled: boolean;
  // ── 입고 버튼 뱃지 (작업 수량 입력된 항목 수) ──
  importBadgeCount: number;
}

type ActionKey = 'note' | 'cancel' | 'missing' | 'label' | 'import' | 'shipping';

interface ActionMeta {
  key:   ActionKey;
  emoji: string;
  /** i18n key */
  labelKey: string;
}

// ── 버튼 메타 정의 (고정 순서: 입고 → 라벨 → 운송장 → 미입고 → 반품 → 비고) ──
const ACTIONS: ActionMeta[] = [
  { key: 'import',   emoji: '📥', labelKey: 'importProductV2.buttons.import' },
  { key: 'label',    emoji: '🏷️', labelKey: 'importProductV2.buttons.label' },
  { key: 'shipping', emoji: '🎟️', labelKey: 'importProductV2.buttons.shipping' },
  { key: 'missing',  emoji: '⚠️', labelKey: 'importProductV2.buttons.missing' },
  { key: 'cancel',   emoji: '↩️', labelKey: 'importProductV2.buttons.cancel' },
  { key: 'note',     emoji: '📝', labelKey: 'importProductV2.buttons.note' },
];

const RightActionSidebar: React.FC<RightActionSidebarProps> = ({
  onNoteClick,
  onCancelClick,
  onMissingClick,
  onLabelClick,
  onImportClick,
  onShippingClick,
  disabled,
  shippingEnabled,
  importBadgeCount,
}) => {
  const { t } = useTranslation();

  const handlerMap: Record<ActionKey, () => void | Promise<void>> = {
    note:     onNoteClick,
    cancel:   onCancelClick,
    missing:  onMissingClick,
    label:    onLabelClick,
    import:   onImportClick,
    shipping: onShippingClick,
  };

  return (
    <aside className="v2-right-action-sidebar">
      {ACTIONS.map(({ key, emoji, labelKey }) => {
        const isImport = key === 'import';
        const showBadge = isImport && importBadgeCount > 0;
        // 운송장: 공통 disabled + 선택된 P+PDF 가 0건이면 비활성화
        const isDisabled = key === 'shipping' ? (disabled || !shippingEnabled) : disabled;

        return (
          <button
            key={key}
            className={`v2-right-action-btn ${showBadge ? 'has-items' : ''}`}
            onClick={handlerMap[key]}
            disabled={isDisabled}
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
