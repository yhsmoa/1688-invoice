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
//   - 흰 바탕 레일, 선 아이콘(20px) 위 + 라벨(11px) 아래
//   - 색은 [입고] 하나만 (파랑 + 작업 수량 입력 건수 뱃지) — 나머지는 회색 글자
// ============================================================

interface RightActionSidebarProps {
  // ── 이벤트 핸들러 ──
  onNoteClick:     () => void;
  onCancelClick:   () => void;
  onMissingClick:  () => void;
  onLabelClick:    () => void;
  onImportClick:   () => void;
  onShippingClick: () => void | Promise<void>;
  /** 고객확인 — 체크된 항목을 Notion 으로 전송 (사이드바 하단 분리 버튼) */
  onCustomerConfirmClick: () => void;

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
  /** 24×24 선 아이콘 path */
  icon:  string;
  /** i18n key */
  labelKey: string;
}

// ── 버튼 메타 정의 (고정 순서: 입고 → 라벨 → 운송장 → 미입고 → 반품 → 비고) ──
const ACTIONS: ActionMeta[] = [
  { key: 'import',   icon: 'M3 13h5l1.5 3h5l1.5-3h5M5 5h14l2 8v6H3v-6z',                 labelKey: 'importProductV2.buttons.import' },
  { key: 'label',    icon: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',                          labelKey: 'importProductV2.buttons.label' },
  { key: 'shipping', icon: 'M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z',             labelKey: 'importProductV2.buttons.shipping' },
  { key: 'missing',  icon: 'M12 3l9.5 17h-19zM12 10v4M12 17h.01',                       labelKey: 'importProductV2.buttons.missing' },
  { key: 'cancel',   icon: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',                    labelKey: 'importProductV2.buttons.cancel' },
  { key: 'note',     icon: 'M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 17h5',                  labelKey: 'importProductV2.buttons.note' },
];

const CUSTOMER_CONFIRM_ICON = 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 11l2 2 4-4';

const ActionIcon: React.FC<{ d: string }> = ({ d }) => (
  <svg className="v2-right-action-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);

const RightActionSidebar: React.FC<RightActionSidebarProps> = ({
  onNoteClick,
  onCancelClick,
  onMissingClick,
  onLabelClick,
  onImportClick,
  onShippingClick,
  onCustomerConfirmClick,
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
      {ACTIONS.map(({ key, icon, labelKey }) => {
        const isImport = key === 'import';
        const showBadge = isImport && importBadgeCount > 0;
        // 운송장: 공통 disabled + 선택된 P+PDF 가 0건이면 비활성화
        const isDisabled = key === 'shipping' ? (disabled || !shippingEnabled) : disabled;

        return (
          <button
            key={key}
            className={`v2-right-action-btn ${isImport ? 'is-primary' : ''} ${showBadge ? 'has-items' : ''}`}
            onClick={handlerMap[key]}
            disabled={isDisabled}
            type="button"
          >
            <ActionIcon d={icon} />
            <span className="v2-right-action-label">{t(labelKey)}</span>
            {showBadge && (
              <span className="v2-right-action-badge">{importBadgeCount}</span>
            )}
          </button>
        );
      })}

      {/* ── 고객확인 — 기존 액션과 구분선으로 분리 (Notion 전송) ── */}
      <div className="v2-right-action-divider" />
      <button
        className="v2-right-action-btn"
        onClick={onCustomerConfirmClick}
        disabled={disabled}
        type="button"
      >
        <ActionIcon d={CUSTOMER_CONFIRM_ICON} />
        <span className="v2-right-action-label">
          {t('importProductV2.buttons.customerConfirm')}
        </span>
      </button>
    </aside>
  );
};

export default RightActionSidebar;
